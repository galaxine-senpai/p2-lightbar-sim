// Data model for the Photon 2 lightbar simulator/exporter.
// Mirrors the authored (raw) COMPONENT table shape and the compiled
// runtime shape the player/renderer/exporter operate on.

export interface RGB {
	r: number;
	g: number;
	b: number;
}

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface Ang3 {
	p: number;
	y: number;
	r: number;
}

/** Raw component data as extracted from Lua (loosely typed -- authoring shape). */
export interface RawComponent {
	Name?: string;
	Author?: string;
	Base?: string;
	Title?: string;
	Category?: string;
	Model?: string;
	Credits?: Record<string, string>;
	WorkshopRequirements?: Record<string, string>;
	Preview?: { Position?: Vec3; Angles?: Ang3; Zoom?: number };
	Templates?: Record<string, Record<string, RawTemplate>>;
	Elements?: RawElement[];
	ElementGroups?: Record<string, number[]>;
	ElementStates?: Record<string, Record<string, RawState>>;
	States?: string[];
	StateMap?: string;
	Segments?: Record<string, RawSegment>;
	Patterns?: Record<string, RawPatternEntry[]>;
	Inputs?: Record<string, Record<string, unknown>>;
	InputPriorities?: Record<string, number>;
	VirtualOutputs?: Record<string, RawVirtualOutputMode[]>;
	Features?: Record<string, unknown>;
	Deprecated?: { Description?: string; Use?: string } | boolean;
	FrameDuration?: number;
	[key: string]: unknown;
}

export interface RawVirtualOutputMode {
	Mode: string;
	Conditions: Record<string, string[]>;
}

export type RawPatternEntry = [string, string] & { Order?: number };

export interface RawTemplate {
	Width?: number;
	Height?: number;
	Scale?: number;
	Detail?: string;
	Shape?: string;
	DeactivationState?: string;
	IntensityGainFactor?: number;
	IntensityLossFactor?: number;
	HorizontalFOV?: number;
	VerticalFOV?: number;
	States?: Record<string, RawState>;
	[key: string]: unknown;
}

export interface RawState {
	Blend?: { r: number; g: number; b: number };
	SourceFillColor?: { From: RGB; To: RGB };
	GlowColor?: { From: RGB; To: RGB };
	InnerGlowColor?: { From: RGB; To: RGB };
	ShapeGlowColor?: { From: RGB; To: RGB };
	SubtractiveMid?: { From: RGB; To: RGB };
	SourceDetailColor?: { From: RGB; To: RGB };
	Intensity?: number;
	IntensityTransitions?: boolean;
	Inherit?: string;
	Title?: string;
	[key: string]: unknown;
}

/** Element as authored: [templateName, Vector?, Angle?, ...namedOverrides] */
export type RawElement = unknown[] & Record<string, unknown>;

export interface RawSegment {
	Off?: string;
	FrameDuration?: number;
	Frames: Record<string, string | unknown[]>;
	Sequences: Record<string, RawSequenceValue>;
}

export type RawSequenceValue =
	| number[]
	| (number[] & {
			IsRepeating?: boolean;
			FrameDuration?: number;
			VariableFrameDuration?: { Slow: number; Fast: number; Rate: number };
	  });

// ===== Compiled runtime model =====

export interface ResolvedState {
	name: string;
	color: RGB;
	intensity: number;
	transitions: boolean;
	gainFactor: number;
	lossFactor: number;
	/** A "proxy state" (`Proxy = { Type = "FROM_LIGHT", Key = N, Value =
	 * "AngleOutput" }`): this state's real color is derived at runtime from
	 * element N's (a rotating Bone) current AngleOutput, not from this
	 * state's own (absent) color data -- used by rotating beacons like the
	 * Vision SLR to color a fixed indicator by the rotor's current angle. */
	proxy?: { key: number };
	/** Present only when `proxy` resolved this state: the referenced Bone's
	 * current live rotation angle (degrees), for the renderer to draw a
	 * directional/crescent cue so a rotating beacon visibly reads as
	 * spinning rather than just changing color. */
	rotationAngle?: number;
}

/** A Bone element's state: describes motion (continuous rotation, sweeping
 * back and forth, or moving to a fixed angle), not a color. See
 * lua/photon-v2/library/components/photon_fedsig_visionslr.lua for the
 * canonical real-world usage this mirrors. */
export interface BoneStateDef {
	activity: string; // "Rotate" | "Sweep" | "Fixed" | "Spot" | ...
	target?: number; // degrees, for "Fixed"
	speed?: number; // degrees/second
	direction?: number; // 1 | -1
	sweepStart?: number;
	sweepEnd?: number;
	sweepPause?: number; // seconds to dwell at each sweep endpoint
	/** Maps the bone's current rotation angle to a state name other
	 * elements can pick up via a `proxy` reference -- e.g. `{angle:0,
	 * state:"R"}` means "from this angle onward (until the next
	 * breakpoint), the beacon reads as red." */
	angleOutputMap?: Array<{ angle: number; state: string }>;
}

export interface CompiledElement {
	index: number;
	templateGroup: string; // "2D", "Mesh", "Bone", "Sound", ...
	templateName: string;
	position: Vec3;
	angle: Ang3;
	props: RawTemplate;
	states: Record<string, ResolvedState>;
	/** Only populated for "Bone" elements -- their states describe motion,
	 * not color, so they're compiled separately from `states`. */
	boneStates?: Record<string, BoneStateDef>;
	isVisual: boolean; // true for renderable (2D/Mesh/Projected) elements
}

export interface CompiledFrame {
	assignments: Record<number, string>; // element index -> state name
}

export interface CompiledSequence {
	name: string;
	steps: number[]; // frame indices (0 = zero frame)
	frameDuration?: number;
	variableFrameDuration?: { slow: number; fast: number; rate: number };
	isRepeating: boolean;
}

export interface CompiledSegment {
	name: string;
	off: string;
	frameDuration: number;
	frames: Record<number, CompiledFrame>;
	sequences: Record<string, CompiledSequence>;
	elementsUsed: number[];
	acceptedChannels: Set<string>; // channels this segment has at least one mode entry for
}

export interface InputAssignment {
	sequence: string;
	order?: number;
	/** Degree phase offset from a `SEQ:deg` reference (Photon2's
	 * ParseSequenceName / PhaseOffset). Shifts the sequence's frame cursor by
	 * `round(stepCount * deg/360)` so copies of one pattern on different
	 * segments run out of step. */
	phaseDegrees?: number;
}

export interface VirtualOutputMode {
	mode: string;
	conditions: Record<string, string[]>;
}

export interface CompiledComponent {
	id: string;
	title: string;
	category: string;
	author?: string;
	credits?: Record<string, string>;
	model?: string;
	elements: CompiledElement[];
	segments: Record<string, CompiledSegment>;
	// channel -> mode -> segmentName -> assignment
	inputs: Record<string, Record<string, Record<string, InputAssignment>>>;
	inputPriorities: Record<string, number>;
	/** Condition-based derived channels (COMPONENT.VirtualOutputs), e.g.
	 * "Virtual.ParkedWarning" -> MODE3 when Vehicle.Transmission=PARK AND
	 * Emergency.Warning=MODE3. Evaluated automatically by ComponentPlayer
	 * from the real channels' current modes -- see player.ts. */
	virtualOutputs: Record<string, VirtualOutputMode[]>;
	patterns: Record<string, RawPatternEntry[]>;
	elementGroups: Record<string, number[]>;
	stateSlots: string[];
	stateMapRaw?: string;
	warnings: string[];
	raw: RawComponent;
}

export const DEFAULT_INPUT_PRIORITIES: Record<string, number> = {
	"Emergency.Cut": 160,
	"Emergency.Illuminate": 150,
	"Emergency.SceneForward": 140,
	"Emergency.SceneLeft": 130,
	"Emergency.SceneRight": 120,
	"Vehicle.Signal": 110,
	"Vehicle.Brake": 100,
	"Vehicle.Transmission": 90,
	"Emergency.Directional": 80,
	"Emergency.Auxiliary": 70,
	"Emergency.Siren2Override": 61,
	"Emergency.SirenOverride": 60,
	"Emergency.Siren2": 51,
	"Emergency.Siren": 50,
	"Emergency.Warning": 40,
	"Emergency.Marker": 30,
	"Vehicle.HighBeam": 20,
	"Vehicle.Lights": 10,
	"Vehicle.Ambient": 0,
};

export const STANDARD_CHANNELS: Record<string, string[]> = {
	"Emergency.Warning": ["MODE1", "MODE2", "MODE3"],
	"Emergency.SceneForward": ["ON", "FLOOD"],
	"Emergency.SceneLeft": ["ON"],
	"Emergency.SceneRight": ["ON"],
	"Emergency.Marker": ["ON"],
	"Emergency.Directional": ["LEFT", "RIGHT", "CENOUT"],
	"Emergency.Cut": ["FRONT", "REAR"],
	"Vehicle.Ambient": ["OFF", "DARK"],
	"Vehicle.Lights": ["HEADLIGHTS", "PARKING", "AUTO"],
	"Vehicle.Brake": ["BRAKE"],
	"Vehicle.Signal": ["LEFT", "RIGHT", "HAZARD"],
	"Vehicle.Transmission": ["PARK", "DRIVE", "REVERSE"],
};
