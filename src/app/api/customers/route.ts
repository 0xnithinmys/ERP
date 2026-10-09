import { z } from "zod";
import { route } from "@/server/api/handler";
import { customerSchema } from "@/validators/masters";
import { createCustomer, searchCustomers } from "@/server/services/party.service";

export const GET = route({ permission: "customers.view" }, async ({ actor, query }) =>
  searchCustomers(actor, query(z.object({ q: z.string().max(100).default("") })).q),
);
export const POST = route({ permission: "customers.manage" }, async ({ actor, body }) => createCustomer(actor, await body(customerSchema)));
