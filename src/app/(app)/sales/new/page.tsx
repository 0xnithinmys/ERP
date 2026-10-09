import { requirePagePermission } from "@/server/auth/session";
import { PosScreen } from "@/features/pos/pos-screen";

export const metadata = { title: "POS — New sale" };

export default async function NewSalePage() {
  await requirePagePermission("sales.create");
  return <PosScreen />;
}
