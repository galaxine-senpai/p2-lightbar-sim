import type { RawComponent } from "./types";

/** A minimal, valid, empty custom component to start building from scratch. */
export function createBlankComponent(): RawComponent {
	return {
		Name: "custom_lightbar",
		Title: "Custom Lightbar",
		Category: "Lightbar",
		Author: "You",
		Templates: {
			"2D": {
				Generic: {
					Width: 4,
					Height: 4,
					Scale: 1,
				},
			},
		},
		Elements: [],
		ElementGroups: {},
		Segments: {},
		Inputs: {},
		InputPriorities: {},
		Patterns: {},
	};
}
