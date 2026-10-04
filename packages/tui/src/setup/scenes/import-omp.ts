import { SelectList } from "../../components/select-list";
import { getSelectListTheme, theme } from "../../theme/theme";
import { replaceTabs, wrapTextWithAnsi } from "../../utils";
import type { SetupScene, SetupSceneController, SetupSceneHost } from "./types";

class ImportScene implements SetupSceneController {
	title = "Import OMP settings?";
	subtitle = "Copy settings and login data. Your OMP installation stays intact.";
	readonly #host: SetupSceneHost;
	readonly #list: SelectList;
	#busy = false;
	#status = "Checking available settings and accounts…";
	constructor(host: SetupSceneHost) {
		this.#host = host;
		this.#list = new SelectList(
			[
				{ value: "skip", label: "Start fresh", description: "Configure Pi Forge separately" },
				{
					value: "import",
					label: "Copy settings and login data",
					description: "Skip existing Forge data; sessions and assets can be imported later",
				},
			],
			2,
			getSelectListTheme(),
		);
		this.#list.onCancel = () => host.finish("skipped");
		this.#list.onSelect = item => {
			void this.#select(item.value);
		};
	}
	async onMount(): Promise<void> {
		const report = await this.#host.ctx.previewOmpImport?.();
		this.#status = report
			? `${report.copied} items available; ${report.skipped} existing items will be skipped. ${report.warnings.join(" ")}`
			: "No import available.";
		this.#host.requestRender();
	}
	async #select(value: string): Promise<void> {
		if (this.#busy) return;
		if (value === "skip") {
			this.#host.finish("skipped");
			return;
		}
		this.#busy = true;
		try {
			await this.#host.ctx.importOmp?.();
			this.#host.finish("done");
		} catch {
			this.#status = "Import could not finish. Existing data was preserved; retry with pi-forge config import-omp.";
		} finally {
			this.#busy = false;
			this.#host.requestRender();
		}
	}
	handleInput(data: string): void {
		if (!this.#busy) this.#list.handleInput(data);
	}
	invalidate(): void {
		this.#list.invalidate();
	}
	render(width: number): string[] {
		return [
			...wrapTextWithAnsi(theme.fg("muted", replaceTabs(this.#status)), width),
			"",
			...this.#list.render(width),
		];
	}
}
export const importOmpSetupScene: SetupScene = {
	id: "import-omp",
	title: "Import OMP data",
	minVersion: 2,
	shouldRun: async ctx => !!ctx.importOmp && (await ctx.previewOmpImport?.())?.copied !== 0,
	mount: host => new ImportScene(host),
};
