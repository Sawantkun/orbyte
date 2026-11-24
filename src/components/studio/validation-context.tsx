"use client";

import { createContext, useContext, useMemo } from "react";
import type { ValidationIssue, ValidationResult } from "@/lib/workflow/validate";

const ValidationContext = createContext<ValidationResult>({ valid: true, issues: [] });

export const ValidationProvider = ValidationContext.Provider;

export function useValidation() {
  return useContext(ValidationContext);
}

export function useNodeIssues(nodeId: string): ValidationIssue[] {
  const { issues } = useContext(ValidationContext);
  return useMemo(() => issues.filter((i) => i.nodeId === nodeId), [issues, nodeId]);
}
