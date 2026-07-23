'use strict';
'require form';
'require view';
'require uci';
'require poll';
'require ui';
'require tools.momo as momo';

function renderStatus(running) {
    return updateStatus(E('input', { id: 'core_status', style: 'border: unset; font-style: italic; font-weight: bold;', readonly: '' }), running);
}

function updateStatus(element, running) {
    if (element) {
        element.style.color = running ? 'green' : 'red';
        element.value = running ? _('Running') : _('Not Running');
    }
    return element;
}

function updateDashboardButton(running) {
    const btn = document.querySelector('.cbi-button[name*="open_dashboard"]');
    if (btn) {
        btn.disabled = !running;
    }
}

function renderCoreVersion(version) {
    return updateCoreVersion(E('input', { id: 'core_version_value', style: 'border: unset;', readonly: '' }), version);
}

function updateCoreVersion(element, version) {
    if (element) {
        if (version) {
            element.style.color = '';
            element.style.fontStyle = 'normal';
            element.value = version;
        } else {
            element.style.color = '#c00';
            element.style.fontStyle = 'italic';
            element.value = _('Not installed, click "Update Core" below');
        }
    }
    return element;
}

function handleCoreUpdate(channel) {
    return momo.updateCore(channel).then(function (result) {
        if (!result?.success) {
            ui.addNotification(null, E('p', result?.message || _('Core update failed')), 'error');
            return;
        }

        if (!result.updated) {
            ui.addNotification(null, E('p', _('Core is already up to date (%s)').format(result.current || result.latest || '')), 'info');
            return;
        }

        return L.resolveDefault(momo.restart()).then(function () {
            updateCoreVersion(document.getElementById('core_version_value'), result.latest);
            ui.addNotification(null, E('p', _('Core updated: %s -> %s, service restarted').format(result.current || '?', result.latest)), 'info');
        });
    }).catch(function (err) {
        ui.addNotification(null, E('p', err.message || String(err)), 'error');
    });
}

return view.extend({
    load: function () {
        return Promise.all([
            uci.load('momo'),
            momo.version(),
            momo.status(),
            momo.listProfiles()
        ]);
    },
    render: function (data) {
        const subscriptions = uci.sections('momo', 'subscription');
        const coreVersion = data[1].core ?? '';
        const running = data[2];
        const profiles = data[3];

        let m, s, o;

        m = new form.Map('momo', _('Momo'), `${_('Transparent Proxy with sing-box on OpenWrt.')} <a href="https://github.com/nikkinikki-org/OpenWrt-momo/wiki" target="_blank">${_('How To Use')}</a>`);

        s = m.section(form.TableSection, 'placeholder', _('Status'));
        s.anonymous = true;

        o = s.option(form.DummyValue, '_core_version', _('Core Version'));
        o.cfgvalue = function () {
            return renderCoreVersion(coreVersion);
        };

        o = s.option(form.DummyValue, '_core_status', _('Core Status'));
        o.cfgvalue = function () {
            return renderStatus(running);
        };
        poll.add(function () {
            return L.resolveDefault(momo.status()).then(function (running) {
                updateStatus(document.getElementById('core_status'), running);
                updateDashboardButton(running);
            });
        });

        o = s.option(form.Button, 'reload');
        o.inputstyle = 'action';
        o.inputtitle = _('Reload Service');
        o.onclick = function () {
            return momo.reload();
        };

        o = s.option(form.Button, 'restart');
        o.inputstyle = 'negative';
        o.inputtitle = _('Restart Service');
        o.onclick = function () {
            return momo.restart();
        };

        o = s.option(form.Button, 'update_dashboard');
        o.inputstyle = 'positive';
        o.inputtitle = _('Update Dashboard');
        o.onclick = function () {
            return momo.updateDashboard();
        };

        o = s.option(form.Button, 'open_dashboard');
        o.inputstyle = 'action';
        o.inputtitle = _('Open Dashboard');
        o.readonly = !running;
        o.onclick = function () {
            return momo.openDashboard();
        };

        o = s.option(form.Button, 'update_core_stable');
        o.inputstyle = 'positive';
        o.inputtitle = _('Stable 核心');
        o.onclick = function () {
            return handleCoreUpdate('stable');
        };

        o = s.option(form.Button, 'update_core_beta');
        o.inputstyle = 'positive';
        o.inputtitle = _('alpha 核心');
        o.onclick = function () {
            return handleCoreUpdate('alpha');
        };

        s = m.section(form.NamedSection, 'config', 'config', _('App Config'));

        o = s.option(form.Flag, 'enabled', _('Enable'));
        o.rmempty = false;

        o = s.option(form.ListValue, 'profile', _('Choose Profile'));
        o.optional = true;

        for (const profile of profiles) {
            o.value('file:' + profile.name, _('File:') + profile.name);
        };

        for (const subscription of subscriptions) {
            o.value('subscription:' + subscription['.name'], _('Subscription:') + subscription.name);
        };

        o = s.option(form.Value, 'start_delay', _('Start Delay'));
        o.datatype = 'uinteger';
        o.placeholder = _('Start Immidiately');

        o = s.option(form.Flag, 'scheduled_restart', _('Scheduled Restart'));
        o.rmempty = false;

        o = s.option(form.Value, 'scheduled_restart_cron', _('Scheduled Restart Cron'));
        o.retain = true;
        o.rmempty = false;
        o.depends('scheduled_restart', '1');

        o = s.option(form.Flag, 'test_profile', _('Test Profile'));
        o.rmempty = false;

        o = s.option(form.Flag, 'core_only', _('Core Only'));
        o.rmempty = false;

        o = s.option(form.Value, 'core_update_proxy', _('Core Update Proxy'));
        o.placeholder = 'https://gh.445568.xyz';
        o.description = _('GitHub accelerator prefix used when downloading core update packages. Leave empty to fetch directly.');

        s = m.section(form.NamedSection, 'procd', 'procd', _('procd Config'));

        s.tab('general', _('General Config'));

        o = s.taboption('general', form.Flag, 'fast_reload', _('Fast Reload'));
        o.rmempty = false;

        s.tab('rlimit', _('RLIMIT Config'));

        o = s.taboption('rlimit', form.Value, 'rlimit_nproc_soft', _('Number of Processes Soft Limit'));
        o.datatype = 'uinteger';

        o = s.taboption('rlimit', form.Value, 'rlimit_nproc_hard', _('Number of Processes Hard Limit'));
        o.datatype = 'uinteger';

        o = s.taboption('rlimit', form.Value, 'rlimit_address_space_soft', _('Address Space Size Soft Limit'));
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('rlimit', form.Value, 'rlimit_address_space_hard', _('Address Space Size Hard Limit'));
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('rlimit', form.Value, 'rlimit_data_soft', _('Heap Size Soft Limit'));
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('rlimit', form.Value, 'rlimit_data_hard', _('Heap Size Hard Limit'));
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('rlimit', form.Value, 'rlimit_stack_soft', _('Stack Size Soft Limit'));
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('rlimit', form.Value, 'rlimit_stack_hard', _('Stack Size Hard Limit'));
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('rlimit', form.Value, 'rlimit_nofile_soft', _('Number of Open Files Soft Limit'));
        o.datatype = 'uinteger';

        o = s.taboption('rlimit', form.Value, 'rlimit_nofile_hard', _('Number of Open Files Hard Limit'));
        o.datatype = 'uinteger';

        s.tab('environment_variable', _('Environment Variable Config'));

        o = s.taboption('environment_variable', form.Value, 'env_go_max_procs', 'GOMAXPROCS');
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('environment_variable', form.Value, 'env_go_mem_limit', 'GOMEMLIMIT');
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        return m.render().then(function (node) {
            node.querySelectorAll('.cbi-button').forEach(function (btn) {
                btn.style.minWidth = '90px';
                btn.style.padding = '3px 10px';
                btn.style.textAlign = 'center';
            });
            return node;
        });
    }
});
