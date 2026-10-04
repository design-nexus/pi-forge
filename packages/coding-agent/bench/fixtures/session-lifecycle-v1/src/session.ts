export interface Capability {
	name: string;
	instruction: string;
}

export interface PromptSnapshot {
	revision: number;
	tools: string[];
	instructions: string[];
}

export class PromptSession {
	#streaming = false;
	#revision = 0;
	#active = new Map<string, Capability>();
	#pending = new Map<string, Capability | null>();

	beginTurn(): void {
		this.#streaming = true;
	}

	activate(capability: Capability): void {
		if (this.#streaming) {
			this.#active.set(capability.name, capability);
			return;
		}
		this.#commit(capability.name, capability);
	}

	deactivate(name: string): void {
		this.#active.delete(name);
		this.#revision++;
	}

	endTurn(): void {
		this.#streaming = false;
		for (const [name, capability] of this.#pending) this.#commit(name, capability);
		this.#pending.clear();
	}

	snapshot(): PromptSnapshot {
		return {
			revision: this.#revision,
			tools: [...this.#active.keys()].sort(),
			instructions: [...this.#active.values()].map(item => item.instruction).sort(),
		};
	}

	#commit(name: string, capability: Capability | null): void {
		if (capability) this.#active.set(name, capability);
		else this.#active.delete(name);
		this.#revision++;
	}
}
