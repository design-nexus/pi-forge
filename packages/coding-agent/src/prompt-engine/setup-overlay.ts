import { type SelectItem, SelectList, type SgrMouseEvent, Text } from "@oh-my-pi/pi-tui";
import { OverlayPanel } from "@oh-my-pi/pi-tui/chrome/overlay-box";
import { routeSelectListMouseWithTopBorder } from "@oh-my-pi/pi-tui/chrome/select-list-mouse-routing";
import { getSelectListTheme } from "@oh-my-pi/pi-tui/theme/theme";
import type { AgentSession } from "../session/agent-session";
import {
	PROMPT_CAPABILITY_IDS,
	resolveCapabilityPolicies,
	resolvePromptPolicies,
	type PromptCapabilityId,
	type PromptCapabilityPolicies,
	type PromptModuleId,
	type PromptModulePolicies,
	type PromptPolicy,
	type PromptProfile,
} from "./profiles";

const EDITABLE_MODULES: readonly PromptModuleId[] = [
	"delegation",
	"workflow",
	"workflow-cleanup",
	"repo-context",
	"prefix-bound-tools",
];
const PROFILE_NAMES: readonly PromptProfile[] = ["minimal", "coding", "agentic", "full", "custom"];
const POLICIES: readonly PromptPolicy[] = ["always", "automatic", "disabled"];

type Stage = "profile" | "modules" | "module-policy" | "capabilities" | "capability-policy" | "scope";

export class PromptSetupOverlay extends OverlayPanel {
	#stage: Stage = "profile";
	#list!: SelectList;
	#profile: PromptProfile;
	#overrides: PromptModulePolicies;
	#capabilityOverrides: PromptCapabilityPolicies;
	#selectedModule: PromptModuleId = "workflow";
	#selectedCapability: PromptCapabilityId = "lsp";
	readonly #session: AgentSession;
	readonly #save: (
		scope: "session" | "user" | "project",
		profile: PromptProfile,
		overrides: PromptModulePolicies,
		capabilities: PromptCapabilityPolicies,
	) => Promise<void>;
	readonly #close: () => void;
	readonly #requestRender: () => void;

	constructor(
		session: AgentSession,
		profile: PromptProfile,
		overrides: PromptModulePolicies,
		capabilities: PromptCapabilityPolicies,
		save: (
			scope: "session" | "user" | "project",
			profile: PromptProfile,
			overrides: PromptModulePolicies,
			capabilities: PromptCapabilityPolicies,
		) => Promise<void>,
		close: () => void,
		requestRender: () => void,
	) {
		super("Prompt Setup");
		this.#session = session;
		this.#profile = profile;
		this.#overrides = { ...overrides };
		this.#capabilityOverrides = { ...capabilities };
		this.#save = save;
		this.#close = close;
		this.#requestRender = requestRender;
		this.#renderStage();
	}

	#estimatedTokens(): number {
		const composition = this.#session.promptComposition;
		if (!composition) return 0;
		const policies = resolvePromptPolicies(this.#profile, this.#overrides);
		const capabilities = resolveCapabilityPolicies(this.#profile, this.#capabilityOverrides);
		return composition.sections.reduce((total, section) => {
			if (section.id === "opaque") return total + section.tokens;
			const policy = policies[section.id];
			const disabled =
				policy === "disabled" ||
				(section.id === "delegation" && capabilities.subagents === "disabled") ||
				(section.id === "testing" && capabilities.testing === "disabled") ||
				(section.id === "repo-context" && capabilities.git === "disabled");
			return total + (disabled ? 0 : section.tokens);
		}, 0);
	}

	#renderStage(): void {
		this.clear();
		const policies = resolvePromptPolicies(this.#profile, this.#overrides);
		const capabilities = resolveCapabilityPolicies(this.#profile, this.#capabilityOverrides);
		this.addChild(
			new Text(
				`Profile: ${this.#profile} · Estimated base (current tools): ${this.#estimatedTokens().toLocaleString()} text tokens`,
				1,
				0,
			),
		);
		let items: SelectItem[];
		switch (this.#stage) {
			case "profile":
				items = PROFILE_NAMES.map(name => ({
					value: name,
					label: name,
					description: name === this.#profile ? "selected" : undefined,
				}));
				break;
			case "modules":
				items = [
					...EDITABLE_MODULES.map(id => ({ value: id, label: id, description: policies[id] })),
					{ value: "capabilities", label: "Capability policies" },
					{ value: "save", label: "Save configuration" },
					{ value: "profile", label: "Change profile" },
				];
				break;
			case "module-policy":
				items = POLICIES.map(policy => ({
					value: policy,
					label: policy,
					description: `${this.#selectedModule} policy`,
				}));
				break;
			case "capabilities":
				items = [
					...PROMPT_CAPABILITY_IDS.map(id => ({ value: id, label: id, description: capabilities[id] })),
					{ value: "back", label: "Back to prompt modules" },
				];
				break;
			case "capability-policy":
				items = POLICIES.map(policy => ({
					value: policy,
					label: policy,
					description: `${this.#selectedCapability} policy`,
				}));
				break;
			case "scope":
				items = [
					{ value: "session", label: "This session", description: "Temporary; not saved" },
					{ value: "user", label: "User configuration", description: "Save for all projects" },
					{ value: "project", label: "Project configuration", description: "Save for this project" },
				];
				break;
		}
		this.#list = new SelectList(items, Math.min(items.length, 9), getSelectListTheme());
		this.#list.onSelect = item => {
			switch (this.#stage) {
				case "profile":
					this.#profile = item.value as PromptProfile;
					this.#stage = "modules";
					break;
				case "modules":
					if (item.value === "save") this.#stage = "scope";
					else if (item.value === "profile") this.#stage = "profile";
					else if (item.value === "capabilities") this.#stage = "capabilities";
					else {
						this.#selectedModule = item.value as PromptModuleId;
						this.#stage = "module-policy";
					}
					break;
				case "module-policy":
					this.#overrides[this.#selectedModule] = item.value as PromptPolicy;
					this.#stage = "modules";
					break;
				case "capabilities":
					if (item.value === "back") this.#stage = "modules";
					else {
						this.#selectedCapability = item.value as PromptCapabilityId;
						this.#stage = "capability-policy";
					}
					break;
				case "capability-policy":
					this.#capabilityOverrides[this.#selectedCapability] = item.value as PromptPolicy;
					this.#stage = "capabilities";
					break;
				case "scope":
					void this.#save(
						item.value as "session" | "user" | "project",
						this.#profile,
						this.#overrides,
						this.#capabilityOverrides,
					);
					return;
			}
			this.#renderStage();
			this.#requestRender();
		};
		this.#list.onCancel = () => {
			if (this.#stage === "profile" || this.#stage === "modules") this.#close();
			else {
				this.#stage = this.#stage === "capability-policy" ? "capabilities" : "modules";
				this.#renderStage();
				this.#requestRender();
			}
		};
		this.addChild(this.#list);
	}

	handleInput(data: string): void {
		this.#list.handleInput(data);
	}

	routeMouse(event: SgrMouseEvent, line: number, col: number): void {
		routeSelectListMouseWithTopBorder(this.#list, event, line - 1, col);
	}
}
