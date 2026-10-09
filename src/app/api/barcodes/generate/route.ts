import { route } from "@/server/api/handler";
import { generateUniqueBarcode } from "@/server/services/product.service";

export const GET = route({ permission: "products.manage" }, async () => ({ barcode: await generateUniqueBarcode() }));
