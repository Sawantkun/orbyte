/**
 * Feature availability by milestone. UI entry points for features that are not
 * built yet render as disabled ("Coming in Milestone N") instead of linking to
 * non-functional screens. Flip a flag when its milestone ships.
 */
export const features = {
  workflowStudio: { available: false, milestone: 2 },
  executions: { available: false, milestone: 3 },
  assetLibrary: { available: false, milestone: 4 },
  collections: { available: false, milestone: 4 },
  integrations: { available: false, milestone: 5 },
  usage: { available: false, milestone: 5 },
} as const;

export type FeatureKey = keyof typeof features;
