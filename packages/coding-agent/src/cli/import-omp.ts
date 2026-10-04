import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as syncFs from "node:fs";
import { SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai/auth/sqlite-credential-store";
import { REMOTE_REFRESH_SENTINEL, type AuthCredential, type StoredAuthCredential } from "@oh-my-pi/pi-ai/auth/types";
import {
	directoryIsEnterable,
	getAgentDbPath,
	getAgentDir,
	getConfigRootDir,
	getSessionsDir,
	isEnoent,
	pathIsWithin,
} from "@oh-my-pi/pi-utils";

export interface OmpImportOptions {
	from?: string;
	destination?: string;
	sessions?: boolean;
	assets?: boolean;
	dryRun?: boolean;
}
export interface OmpImportReport {
	copied: string[];
	skipped: string[];
	warnings: string[];
	dryRun: boolean;
}

/** Copy selected user data; never traverse symlinks or overwrite destination data. */
export async function importOmpData(options: OmpImportOptions = {}): Promise<OmpImportReport> {
	const root = path.resolve(options.from ?? path.join(os.homedir(), ".omp"));
	const source = path.join(root, "agent");
	const destination = options.destination ?? getAgentDir();
	if (pathIsWithin(root, destination) || pathIsWithin(destination, root))
		throw new Error("Import source and destination must not overlap");
	const report: OmpImportReport = { copied: [], skipped: [], warnings: [], dryRun: !!options.dryRun };
	const copy = async (src: string, dest: string): Promise<void> => {
		let stat;
		try {
			stat = await fs.lstat(src);
		} catch (error) {
			if (isEnoent(error)) return;
			throw error;
		}
		if (stat.isSymbolicLink()) {
			report.skipped.push(`${src} (symlink)`);
			return;
		}
		try {
			const targetStat = await fs.lstat(dest);
			if (targetStat.isSymbolicLink()) {
				report.skipped.push(`${dest} (symlink)`);
				return;
			}
		} catch (error) {
			if (!isEnoent(error)) throw error;
		}
		if (stat.isDirectory()) {
			for (const entry of await fs.readdir(src)) await copy(path.join(src, entry), path.join(dest, entry));
			return;
		}
		if (!stat.isFile()) return;
		try {
			await fs.lstat(dest);
			report.skipped.push(dest);
			return;
		} catch (error) {
			if (!isEnoent(error)) throw error;
		}
		if (!options.dryRun) {
			await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
			try {
				await fs.copyFile(src, dest, syncFs.constants.COPYFILE_EXCL);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") {
					report.skipped.push(dest);
					return;
				}
				throw error;
			}
			await fs.chmod(dest, 0o600);
		}
		report.copied.push(dest);
	};
	for (const file of ["config.yml", "config.yaml", "models.yml", "models.yaml", "models.json", "settings.json"])
		await copy(path.join(source, file), path.join(destination, file));
	let credentials: StoredAuthCredential[] = [];
	const useXdgData =
		!options.from &&
		process.env.XDG_DATA_HOME &&
		(await directoryIsEnterable(path.join(process.env.XDG_DATA_HOME, "omp")));
	const dbFile =
		useXdgData && process.env.XDG_DATA_HOME
			? path.join(process.env.XDG_DATA_HOME, "omp/agent.db")
			: path.join(source, "agent.db");
	const destinationDb = options.destination ? path.join(destination, "agent.db") : getAgentDbPath();
	try {
		await fs.stat(dbFile);
		credentials = SqliteAuthCredentialStore.readSnapshot(dbFile);
	} catch (error) {
		if (!isEnoent(error))
			report.warnings.push("Could not read OMP login data; use pi-forge login for these accounts.");
	}
	const existingProviders = new Set<string>();
	try {
		for (const item of SqliteAuthCredentialStore.readSnapshot(destinationDb)) existingProviders.add(item.provider);
	} catch (error) {
		let exists = true;
		try {
			await fs.stat(destinationDb);
		} catch (statError) {
			if (!isEnoent(statError)) throw statError;
			exists = false;
		}
		if (exists) throw error;
	}
	let target: SqliteAuthCredentialStore | undefined;
	try {
		if (credentials.length && !options.dryRun) target = await SqliteAuthCredentialStore.open(destinationDb);
		const groups = new Map<string, AuthCredential[]>();
		for (const item of credentials) {
			if (
				item.credential.type === "oauth" &&
				(!item.credential.refresh || item.credential.refresh === REMOTE_REFRESH_SENTINEL)
			) {
				report.warnings.push(`${item.provider}: login again; credential cannot be copied`);
				continue;
			}
			const values = groups.get(item.provider) ?? [];
			values.push(item.credential);
			groups.set(item.provider, values);
		}
		for (const [provider, values] of groups) {
			if (existingProviders.has(provider) || target?.listAuthCredentials(provider).length) {
				report.skipped.push(`login:${provider}`);
				continue;
			}
			if (target) await target.replaceAuthCredentials(provider, values);
			report.copied.push(`login:${provider}`);
		}
	} finally {
		target?.close();
	}
	if (options.sessions) {
		const sessionsSource =
			useXdgData && process.env.XDG_DATA_HOME
				? path.join(process.env.XDG_DATA_HOME, "omp/sessions")
				: path.join(source, "sessions");
		await copy(sessionsSource, options.destination ? path.join(destination, "sessions") : getSessionsDir());
	}
	if (options.assets) {
		for (const directory of ["agents", "skills", "rules", "themes", "extensions", "tools", "prompts"])
			await copy(path.join(source, directory), path.join(destination, directory));
		await copy(
			path.join(root, "themes"),
			path.join(options.destination ? path.dirname(destination) : getConfigRootDir(), "themes"),
		);
	}
	return report;
}
