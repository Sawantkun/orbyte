import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PromptTemplateInput } from "@/lib/validation/workflow";
import { templateVariables } from "@/lib/workflow/templates";
import { conflict, notFound } from "./errors";

export type PromptTemplateDto = {
  id: string;
  name: string;
  description: string | null;
  content: string;
  variables: string[];
  updatedAt: string;
};

const select = { id: true, name: true, description: true, content: true, variables: true, updatedAt: true } as const;
const toDto = (t: Prisma.PromptTemplateGetPayload<{ select: typeof select }>): PromptTemplateDto => ({
  ...t,
  updatedAt: t.updatedAt.toISOString(),
});

function rethrowUnique(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw conflict("You already have a template with this name.");
  }
  throw e;
}

export async function listPromptTemplates(ownerId: string, q?: string): Promise<PromptTemplateDto[]> {
  const rows = await db.promptTemplate.findMany({
    where: {
      ownerId,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select,
  });
  return rows.map(toDto);
}

export async function createPromptTemplate(ownerId: string, input: PromptTemplateInput): Promise<PromptTemplateDto> {
  try {
    const t = await db.promptTemplate.create({
      data: { ownerId, name: input.name, description: input.description || null, content: input.content, variables: templateVariables(input.content) },
      select,
    });
    return toDto(t);
  } catch (e) {
    rethrowUnique(e);
  }
}

export async function updatePromptTemplate(ownerId: string, id: string, input: Partial<PromptTemplateInput>): Promise<PromptTemplateDto> {
  const data: Prisma.PromptTemplateUpdateManyMutationInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description || null;
  if (input.content !== undefined) {
    data.content = input.content;
    data.variables = templateVariables(input.content);
  }
  try {
    const { count } = await db.promptTemplate.updateMany({ where: { id, ownerId }, data });
    if (count === 0) throw notFound("Prompt template");
  } catch (e) {
    rethrowUnique(e);
  }
  return toDto(await db.promptTemplate.findFirstOrThrow({ where: { id, ownerId }, select }));
}

export async function deletePromptTemplate(ownerId: string, id: string): Promise<void> {
  const { count } = await db.promptTemplate.deleteMany({ where: { id, ownerId } });
  if (count === 0) throw notFound("Prompt template");
}
