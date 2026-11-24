import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put } from '../api.js';
import { Card, ErrorBox, Field, Loading, Page, Sev, TypeChips } from '../components.jsx';

export default function FrameworkEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [controls, setControls] = useState([]);
  const [selected, setSelected] = useState({}); // controlId -> reference
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cs = await get('/api/controls');
        setControls(cs.items);
        if (id) {
          const fw = await get(`/api/frameworks/${id}`);
          setForm({ key: fw.key, name: fw.name, description: fw.description || '', version: fw.version || '' });
          setSelected(Object.fromEntries(fw.controls.map((c) => [c.id, c.reference || ''])));
        } else {
          setForm({ key: '', name: '', description: '', version: '1.0' });
        }
      } catch (err) { setError(err); }
    })();
  }, [id]);

  const shown = useMemo(() => controls.filter((c) => !filter || `${c.key} ${c.name} ${c.asset_types.join(' ')}`.toLowerCase().includes(filter.toLowerCase())), [controls, filter]);

  if (!form) return <Page title="Framework"><ErrorBox error={error} /><Loading /></Page>;

  const toggle = (cid) => setSelected((s) => {
    const n = { ...s };
    if (cid in n) delete n[cid]; else n[cid] = '';
    return n;
  });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...form, controls: Object.entries(selected).map(([control_id, reference]) => ({ control_id, reference: reference || null })) };
    try {
      const fw = id ? await put(`/api/frameworks/${id}`, body) : await post('/api/frameworks', body);
      navigate(`/frameworks/${fw.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Page title={id ? `Edit ${form.name}` : 'New framework'} crumbs={[{ to: '/frameworks', label: 'Frameworks' }, { label: id ? form.key : 'New' }]}>
      <form onSubmit={save}>
        <Card>
          <div className="form-grid">
            <Field label="Key" hint="Short unique identifier, e.g. CIS-GH"><input value={form.key} disabled={Boolean(id)} onChange={(e) => setForm({ ...form, key: e.target.value })} required /></Field>
            <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Version"><input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
          </div>
          <Field label="Description"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </Card>
        <Card title={`Controls (${Object.keys(selected).length} selected)`} actions={<input className="search" placeholder="Filter controls…" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
          <table className="table compact">
            <thead><tr><th /><th>Control</th><th>Applies to</th><th>Reference</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td><input type="checkbox" checked={c.id in selected} onChange={() => toggle(c.id)} /></td>
                  <td><strong>{c.key}</strong> <Sev s={c.severity} /><div className="small">{c.name}</div></td>
                  <td><TypeChips types={c.asset_types} /></td>
                  <td>{c.id in selected && <input className="ref" placeholder="e.g. 1.2.3" value={selected[c.id]} onChange={(e) => setSelected({ ...selected, [c.id]: e.target.value })} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <ErrorBox error={error} />
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save framework'}</button>
        </div>
      </form>
    </Page>
  );
}
