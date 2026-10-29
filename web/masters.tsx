import { useEffect, useState } from 'react';
import { api, clearApiReads, money } from './api';
import { chargeDepartment, chargeDepartments, chargeGroupLabel, chargeSubgroupOrder } from './charge-groups';

type MasterKind = 'specialities' | 'charge-groups' | 'charges';
const labels: Record<MasterKind, string> = {
  specialities: 'Speciality master',
  'charge-groups': 'Charge group master',
  charges: 'Charge master',
};

export function ClinicMasters({ tick, modal, action, workspace, route, go }: any) {
  const kind = (route.tab || 'specialities') as MasterKind;
  const setKind = (key: MasterKind) => go(`/clinic/masters/${key}`);
  const [data, setData] = useState<Record<MasterKind, any[]> | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [groupId, setGroupId] = useState('');
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState('');
  useEffect(() => setPage(1), [kind, query, status, groupId]);
  const refresh = () => {
    clearApiReads();
    setQuery(''); setStatus('all'); setGroupId('');
    setRetry(value => value + 1);
  };
  useEffect(() => {
    let active = true;
    setError('');
    Promise.all(Object.keys(labels).map((key) => api(`/clinic/${key}`)))
      .then((rows) => {
        if (active) {
          setData({ specialities: rows[0], 'charge-groups': rows[1], charges: rows[2] });
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [tick, retry, kind]);
  const groups = [...(data?.['charge-groups'] || [])].sort((a, b) => {
    const rank = (group: any) => {
      const index = chargeDepartments.indexOf(chargeDepartment(group) as typeof chargeDepartments[number]);
      return index < 0 ? chargeDepartments.length : index;
    };
    return rank(a) - rank(b) || chargeSubgroupOrder(a.name) - chargeSubgroupOrder(b.name) || a.name.localeCompare(b.name);
  });
  const canManage = ['OWNER', 'MANAGER'].includes(workspace?.role);
  const removeCharge = async (row: any) => {
    if (deletingId || !window.confirm(`Permanently delete charge "${row.name}"? Charges linked to treatment records cannot be deleted.`)) return;
    setDeletingId(row.id);
    setError('');
    try {
      await action(() => api(`/clinic/charges/${row.id}`, 'DELETE'), 'Charge deleted', { reportError: false });
      setData(old => old ? { ...old, charges: old.charges.filter(charge => charge.id !== row.id) } : old);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setDeletingId('');
    }
  };
  const edit = (row?: any) => {
    const options = groups
      .filter((group) => group.active || group.id === row?.chargeGroupId)
      .map((group) => ({ value: group.id, label: chargeGroupLabel(group) }));
    modal({
      title: `${row ? 'Edit' : 'Add'} ${kind === 'specialities' ? 'speciality' : kind === 'charge-groups' ? 'charge group' : 'charge'}`,
      subtitle:
        kind === 'charges'
          ? 'Charge is the patient fee. Lab charge is recorded separately.'
          : undefined,
      fields:
        kind === 'charges'
          ? [
              {
                key: 'chargeGroupId',
                label: 'Charge subgroup',
                type: 'select',
                required: true,
                value: row?.chargeGroupId || '',
                options: [{ value: '', label: 'Choose charge subgroup' }, ...options],
              },
              { key: 'name', label: 'Charge name', required: true, value: row?.name },
              {
                key: 'pricePaise',
                label: 'Charge (₹)',
                type: 'money',
                required: true,
                value: row ? row.pricePaise / 100 : 0,
              },
              {
                key: 'labChargePaise',
                label: 'Lab charge (₹)',
                type: 'money',
                required: true,
                value: (row?.labChargePaise || 0) / 100,
              },
            ]
          : [
              ...(kind === 'charge-groups' ? [{
                key: 'groupName',
                label: 'Group name',
                type: 'select',
                required: true,
                value: row ? chargeDepartment(row) : '',
                options: [{ value: '', label: 'Choose group' }, ...chargeDepartments.map(name => ({ value: name, label: name }))],
              }] : []),
              {
                key: 'name',
                label: kind === 'specialities' ? 'Speciality name' : 'Subgroup name',
                required: true,
                value: row?.name,
              },
            ],
      submit: (body: any) =>
        action(() =>
          api(`/clinic/${kind}${row ? `/${row.id}` : ''}`, row ? 'PATCH' : 'POST', body),
        ),
    });
  };
  const rows = (kind === 'charge-groups' ? groups : data?.[kind] || []).filter((row) => {
    const chargeGroup = groups.find((group) => group.id === row.chargeGroupId);
    const group = kind === 'charge-groups' ? chargeDepartment(row) : chargeGroup ? chargeGroupLabel(chargeGroup) : '';
    return (
      `${row.name} ${group}`.toLowerCase().includes(query.toLowerCase()) &&
      (status === 'all' || row.active === (status === 'active')) &&
      (kind !== 'charges' || !groupId || row.chargeGroupId === groupId)
    );
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const firstRow = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(firstRow, firstRow + pageSize);
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CLINIC SETUP</span>
          <h1>Masters</h1>
          <p>Manage specialities, charge groups and charges for your clinic.</p>
        </div>
        <button
          className="primary"
          onClick={() => edit()}
          disabled={
            !canManage || !data || (kind === 'charges' && !groups.some((group) => group.active))
          }
        >
          Add{' '}
          {kind === 'specialities'
            ? 'speciality'
            : kind === 'charge-groups'
              ? 'charge group'
              : 'charge'}
        </button>
      </div>
      <div
        className="segmented"
        style={{ display: 'flex', flexWrap: 'wrap', maxWidth: '100%' }}
        role="tablist"
        aria-label="Master type"
      >
        {(Object.keys(labels) as MasterKind[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={kind === key}
            className={kind === key ? 'selected' : ''}
            onClick={() => {
              setKind(key);
              setQuery('');
            }}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>{labels[kind]}</h2>
            <p>
              {kind === 'charges'
                ? 'Existing treatment prices are included. Assign a group when editing ungrouped charges.'
                : 'Deactivate unused entries to remove them from new selections.'}
            </p>
          </div>
          <button className="secondary small" type="button" onClick={refresh}>Refresh masters</button>
        </div>
        <div className="panel-body form-fields">
          <label>
            Search masters
            <input
              aria-label="Search masters"
              placeholder="Search by name or group"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {kind === 'charges' && <label>
            Charge subgroup
            <select aria-label="Filter by charge group" value={groupId} onChange={event => setGroupId(event.target.value)}>
              <option value="">All charge subgroups</option>
              {groups.map(group => <option key={group.id} value={group.id}>{chargeGroupLabel(group)}</option>)}
            </select>
          </label>}
          <label>
            Status filter
            <select
              aria-label="Status filter"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
              Retry loading
            </button>
          </div>
        )}
        {!data ? (
          <p className="panel-body muted">{error ? 'Masters could not be loaded.' : 'Loading masters…'}</p>
        ) : (
          <>
            {kind === 'charges' && !groups.some((group) => group.active) && (
              <p className="panel-body muted">
                Create an active charge group before adding charges.
              </p>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {kind !== 'specialities' && <th>Group name</th>}
                    {kind === 'charges' && <th>Subgroup name</th>}
                    <th>
                      {kind === 'specialities'
                        ? 'Speciality name'
                        : kind === 'charge-groups'
                          ? 'Subgroup name'
                          : 'Charge name'}
                    </th>
                    {kind === 'charges' && (
                      <>
                        <th>Charge</th>
                        <th>Lab charge</th>
                      </>
                    )}
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.id}>
                      {kind !== 'specialities' && <td>{chargeDepartment(kind === 'charge-groups' ? row : groups.find(group => group.id === row.chargeGroupId) || { name: '' }) || 'Unassigned'}</td>}
                      {kind === 'charges' && (
                        <td>
                          {groups.find((group) => group.id === row.chargeGroupId)?.name ||
                            'Unassigned'}
                        </td>
                      )}
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      {kind === 'charges' && (
                        <>
                          <td>{money(row.pricePaise)}</td>
                          <td>{money(row.labChargePaise || 0)}</td>
                        </>
                      )}
                      <td>
                        <span className="badge">{row.active ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td>
                        {canManage ? (
                          <>
                            <button className="text-button" disabled={!!deletingId} onClick={() => edit(row)}>
                              Edit
                            </button>
                            <button
                              className="text-button"
                              disabled={!!deletingId}
                              onClick={() =>
                                action(() =>
                                  api(`/clinic/${kind}/${row.id}`, 'PATCH', {
                                    active: !row.active,
                                  }),
                                ).catch(() => {})
                              }
                            >
                              {row.active ? 'Deactivate' : 'Activate'}
                            </button>
                            {kind === 'charges' && <button type="button" className="text-button" style={{ color: '#b53e45' }} disabled={!!deletingId} onClick={() => removeCharge(row)}>{deletingId === row.id ? 'Deleting...' : 'Delete'}</button>}
                          </>
                        ) : (
                          'View only'
                        )}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={kind === 'charges' ? 7 : kind === 'charge-groups' ? 4 : 3}>
                        No matching entries. Add a master to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <nav
              aria-label="Masters pagination"
              className="panel-body"
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
            >
              <span className="muted" role="status">
                Showing {rows.length ? firstRow + 1 : 0}–{Math.min(firstRow + pageSize, rows.length)} of {rows.length} entries
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                  Previous
                </button>
                <span>Page {currentPage} of {pageCount}</span>
                <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </section>
    </>
  );
}
