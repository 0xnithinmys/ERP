import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { CalculationError } from "@/lib/calculations";
import { logger } from "./logger";

export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "BUSINESS_RULE"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  BUSINESS_RULE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have permission to perform this action") => new AppError("FORBIDDEN", msg);
export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Please sign in to continue");
export const conflict = (msg: string, details?: unknown) => new AppError("CONFLICT", msg, details);
export const businessRule = (msg: string, details?: unknown) => new AppError("BUSINESS_RULE", msg, details);
export const validation = (msg: string, details?: unknown) => new AppError("VALIDATION", msg, details);

export interface ShortageDetail {
  variantId: string;
  name: string;
  required: string;
  available: string;
  unit?: string;
}

export class InsufficientStockError extends AppError {
  constructor(public shortages: ShortageDetail[], prefix = "Insufficient stock") {
    const lines = shortages.map((s) => `${s.name}: required ${s.required}, available ${s.available}`);
    super("INSUFFICIENT_STOCK", `${prefix}. ${lines.join("; ")}`, { shortages });
  }
}

const UNIQUE_FIELD_LABELS: Record<string, string> = {
  sku: "SKU",
  barcode: "Barcode",
  code: "Product code",
  username: "Username",
  email: "Email",
  phone: "Phone number",
  name: "Name",
};

/** Converts any thrown value into a safe AppError. Raw DB errors are never exposed. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path.join(".");
    return new AppError("VALIDATION", first ? (path ? `${first.message} (${path})` : first.message) : "Invalid input", {
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof CalculationError) return new AppError("VALIDATION", err.message);
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | string | undefined) ?? [];
      const fields = Array.isArray(target) ? target : [target];
      const label = fields.map((f) => UNIQUE_FIELD_LABELS[f] ?? f).join(", ") || "Value";
      return new AppError("CONFLICT", `${label} already exists`);
    }
    if (err.code === "P2025") return new AppError("NOT_FOUND", "Record not found");
    if (err.code === "P2003") return new AppError("CONFLICT", "This record is referenced by other data");
    if (err.code === "P2034") return new AppError("CONFLICT", "The record was changed by someone else. Please try again.");
  }
  logger.error("Unhandled error", err);
  return new AppError("INTERNAL", "Something went wrong. Please try again.");
}
