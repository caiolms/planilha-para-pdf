/* The RPC authorizes every request. Hidden UI is not an access control. */
(function(){
  'use strict';
  window.createAdminPanel = function({ client, getUser }){
    const panel = document.getElementById('adminPanel');
    let revision = 0, visible = false;
    const number = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString('pt-BR') : 'Não disponível';
    const limit = value => value === 0 ? 'Sem limite' : number(value);
    const date = value => {
      if (!value) return '—';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    };
    function clear(){
      panel.hidden = true;
      visible = false;
      panel.querySelectorAll('[data-admin-value]').forEach(el => { el.textContent = ''; });
      document.getElementById('adminUsers').replaceChildren();
      document.getElementById('adminConversions').replaceChildren();
    }
    function rows(id, items, columns){
      const body = document.getElementById(id);
      body.replaceChildren();
      if (!items.length){
        const tr = document.createElement('tr'), td = document.createElement('td');
        td.colSpan = columns.length; td.textContent = 'Nenhum registro neste período.';
        tr.appendChild(td); body.appendChild(tr); return;
      }
      items.slice(0, 50).forEach(item => {
        const tr = document.createElement('tr');
        columns.forEach(column => {
          const td = document.createElement('td');
          td.textContent = String(column(item) ?? '—');
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    }
    function render(data){
      const set = (id, value) => { document.getElementById(id).textContent = value; };
      set('adminUserCount', number(data.usuarios_total));
      set('adminTodayCount', number(data.conversoes_hoje));
      set('adminTotalCount', number(data.conversoes_total));
      set('adminDefaultLimit', limit(data.limite_padrao));
      set('adminUpdated', 'Atualizado em ' + date(data.atualizado_em) + ' · horário de Brasília');
      set('adminNotice', 'Últimos 50 usuários e últimas 50 conversões registradas de contas. O limite diário é igual para todas as contas. O uso sem conta fica no aparelho.');
      rows('adminUsers', data.usuarios, [
        u => u.nome || '—', u => u.email || '—', u => date(u.criado_em),
        u => number(u.conversoes_hoje), u => limit(u.limite_diario)
      ]);
      rows('adminConversions', data.recentes, [
        c => date(c.criado_em), c => c.email || '—', c => c.ferramenta || '—'
      ]);
      panel.hidden = false;
      visible = true;
    }
    async function load(user, request){
      if (!client || !user) return;
      try {
        const { data, error } = await client.rpc('admin_painel');
        if (request !== revision || getUser()?.id !== user.id) return;
        if (error || !data || !Number.isFinite(data.usuarios_total) ||
            !Array.isArray(data.usuarios) || !Array.isArray(data.recentes)){
          clear(); return;
        }
        render(data);
      } catch (e){
        if (request === revision) clear();
      }
    }
    return {
      sync(user){
        const request = ++revision;
        clear();
        // Never call the SDK synchronously from its Auth callback.
        if (user) setTimeout(() => { if (request === revision) load(user, request); }, 0);
      },
      refresh(){
        if (!visible) return;
        const user = getUser(), request = ++revision;
        clear();
        return load(user, request);
      }
    };
  };
})();
