import { z } from "zod";

export const versionParam = z.coerce.number().int().min(1).max(1_000_000);
