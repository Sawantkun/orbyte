/**
 * Feature availability by milestone. UI entry points for features that are not
 * built yet render as disabled ("Coming in Milestone N") instead of linking to
 * non-functional screens. Flip a flag when its milestone ships.
 */
export const features = {
  workflowStudio: { available: true, milestone: 2 },
  executions: { available: true, milestone: 3 },
  assetLibrary: { available: true, milestone: 4 },
  collections: { available: true, milestone: 4 },
  integrations: { available: false, milestone: 5 },
  usage: { available: false, milestone: 5 },
} as const;

export type FeatureKey = keyof typeof features;
