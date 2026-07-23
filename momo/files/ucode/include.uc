import { readfile, writefile, popen } from 'fs';

export function get_paths() {
	let result = {};
	const process = popen('. /etc/momo/scripts/include.sh && get_paths');
	if (process) {
		result = json(process);
		process.close();
	}
	return result;
};

export function uci_bool(obj) {
	return obj == null ? null : obj == '1';
};

export function uci_int(obj) {
	return obj == null ? null : int(obj);
};

export function uci_array(obj) {
	if (obj == null) {
		return [];
	}
	if (type(obj) == 'array') {
		return uniq(obj);
	}
	return [obj];
};

export function merge(target, ...sources) {
	for (let source in sources) {
		for (let key in keys(source)) {
			const target_value = target[key];
			const target_value_type = type(target_value);
			const source_value = source[key];
			const source_value_type = type(source_value);
			if (target_value_type === 'object' && source_value_type === 'object') {
				target[key] = merge(target_value, source_value);
			} else {
				target[key] = source[key];
			}
		}
	}
	return target;
};

export function merge_exists(target, ...sources) {
	for (let source in sources) {
		for (let key in keys(source)) {
			if (exists(target, key)) {
				const target_value = target[key];
				const target_value_type = type(target_value);
				const source_value = source[key];
				const source_value_type = type(source_value);
				if (target_value_type === 'object' && source_value_type === 'object') {
					target[key] = merge_exists(target_value, source_value);
				} else {
					target[key] = source[key];
				}
			}
		}
	}
	return target;
};

export function trim_all(obj) {
	if (obj == null) {
		return null;
	}
	if (type(obj) == 'string') {
		if (length(obj) == 0) {
			return null;
		}
		return obj;
	}
	if (type(obj) == 'array') {
		if (length(obj) == 0) {
			return null;
		}
		return obj;
	}
	if (type(obj) == 'object') {
		const obj_keys = keys(obj);
		for (let key in obj_keys) {
			obj[key] = trim_all(obj[key]);
			if (obj[key] == null) {
				delete obj[key];
			}
		}
		if (length(keys(obj)) == 0) {
			return null;
		}
		return obj;
	}
	return obj;
};

export function get_cgroups_version() {
	return system('mount | grep -q -w "^cgroup"') == 0 ? 1 : 2;
};

export function get_users() {
	return map(split(readfile('/etc/passwd'), '\n'), (x) => split(x, ':')[0]);
};

export function get_groups() {
	return map(split(readfile('/etc/group'), '\n'), (x) => split(x, ':')[0]);
};

export function get_cgroups() {
	const result = [];
	if (get_cgroups_version() == 2) {
		const cgroup_path = '/sys/fs/cgroup/';
		const process = popen(`find ${cgroup_path} -type d -mindepth 1`);
		if (process) {
			for (let line = process.read('line'); length(line); line = process.read('line')) {
				push(result, substr(trim(line), length(cgroup_path)));
			}
		}
	}
	return result;
};

export function load_profile() {
	const paths = get_paths();
	return json(readfile(paths.run_profile_path));
};

export function save_profile(obj) {
	const paths = get_paths();
	return writefile(paths.run_profile_path, obj);
};

export function detect_pkg_manager() {
	if (system('command -v opkg >/dev/null 2>&1') == 0) {
		return 'opkg';
	}
	if (system('command -v apk >/dev/null 2>&1') == 0) {
		return 'apk';
	}
	return null;
};

export function detect_arch(pkg_manager) {
	let arch = null;
	let process;
	if (pkg_manager == 'opkg') {
		process = popen(`opkg print-architecture | awk '$1=="arch" && $2!="all" {print $3, $2}' | sort -rn | head -n1 | cut -d ' ' -f2`);
	} else if (pkg_manager == 'apk') {
		process = popen('cat /etc/apk/arch 2>/dev/null');
	}
	if (process) {
		arch = trim(process.read('all'));
		process.close();
	}
	return length(arch) ? arch : null;
};

export function get_core_version() {
	let core = '';
	const process = popen(`sing-box version | grep sing-box | cut -d ' ' -f 3`);
	if (process) {
		core = trim(process.read('all'));
		process.close();
	}
	return core;
};

// 内置的 GitHub 加速镜像，不对外暴露、不可在 LuCI 界面切换。
// 请求一律先走镜像，镜像失败（网络问题/镜像失效等）再自动回退到 GitHub 直连。
const CORE_UPDATE_MIRROR = 'https://gh.445568.xyz';

function proxify(url) {
	return rtrim(CORE_UPDATE_MIRROR, '/') + '/' + url;
};

// 先试镜像，失败则直连，返回解析后的 JSON（失败返回 null）
function fetch_json_with_fallback(url) {
	let process = popen(`curl -fsSL --max-time 15 '${proxify(url)}'`);
	let data = null;
	if (process) {
		data = json(process);
		process.close();
	}
	if (data != null) {
		return data;
	}
	process = popen(`curl -fsSL --max-time 15 '${url}'`);
	if (process) {
		data = json(process);
		process.close();
	}
	return data;
};

// 先试镜像下载，失败则直连下载
function download_with_fallback(url, dest) {
	if (system(`curl -fsSL --max-time 120 -o '${dest}' '${proxify(url)}'`) == 0) {
		return true;
	}
	system(`rm -f '${dest}'`);
	if (system(`curl -fsSL --max-time 120 -o '${dest}' '${url}'`) == 0) {
		return true;
	}
	system(`rm -f '${dest}'`);
	return false;
};

export function fetch_core_release(channel) {
	const api_url = (channel == 'beta')
		? 'https://api.github.com/repos/SagerNet/sing-box/releases?per_page=15'
		: 'https://api.github.com/repos/SagerNet/sing-box/releases/latest';

	const data = fetch_json_with_fallback(api_url);
	if (!data) {
		return null;
	}

	if (channel == 'beta') {
		if (type(data) != 'array') {
			return null;
		}
		for (let i = 0; i < length(data); i++) {
			if (data[i].prerelease) {
				return data[i];
			}
		}
		return null;
	}

	return data;
};

export function update_core(channel) {
	const result = { success: false, updated: false, current: '', latest: '', message: '' };

	const pkg_manager = detect_pkg_manager();
	if (!pkg_manager) {
		result.message = 'opkg/apk not found';
		return result;
	}

	const arch = detect_arch(pkg_manager);
	if (!arch) {
		result.message = 'failed to detect device architecture';
		return result;
	}

	result.current = get_core_version();

	const release = fetch_core_release(channel);
	if (!release) {
		result.message = 'failed to query release info from github';
		return result;
	}

	let latest = release.tag_name ?? '';
	if (substr(latest, 0, 1) == 'v') {
		latest = substr(latest, 1);
	}
	if (!length(latest)) {
		result.message = 'failed to parse latest version';
		return result;
	}
	result.latest = latest;

	if (latest == result.current) {
		result.success = true;
		result.message = 'already up to date';
		return result;
	}

	// 优先找本机包管理器对应的后缀，找不到再退而求其次找另一种，
	// 避免因为某个版本 release 里只发布了 .apk 或只发布了 .ipk 就直接判定失败。
	const ext_candidates = (pkg_manager == 'opkg') ? ['.ipk', '.apk'] : ['.apk', '.ipk'];
	let asset_url = null;
	let matched_ext = null;
	for (let ext in ext_candidates) {
		for (let i = 0; i < length(release.assets); i++) {
			const name = release.assets[i].name ?? '';
			if (index(name, 'openwrt') >= 0 && index(name, arch) >= 0 && index(name, ext) >= 0) {
				asset_url = release.assets[i].browser_download_url;
				matched_ext = ext;
				break;
			}
		}
		if (asset_url) {
			break;
		}
	}

	if (!asset_url) {
		result.message = `no matching package found for architecture ${arch}`;
		return result;
	}

	// 落盘到 /var/run/momo（run 目录）而不是 /tmp，避免下载核心包占用运行内存。
	const paths = get_paths();
	const tmp_file = `${paths.run_dir}/sing-box-core${matched_ext}`;
	const download_ok = download_with_fallback(asset_url, tmp_file);
	if (!download_ok) {
		result.message = 'failed to download core package';
		return result;
	}

	let install_ok;
	if (matched_ext == '.ipk') {
		install_ok = system(`opkg install --force-reinstall '${tmp_file}'`) == 0;
	} else {
		install_ok = system(`apk add --allow-untrusted '${tmp_file}'`) == 0;
	}

	system(`rm -f '${tmp_file}'`);

	if (!install_ok) {
		result.message = 'failed to install core package';
		return result;
	}

	result.success = true;
	result.updated = true;
	result.message = `updated to ${latest}`;
	return result;
};