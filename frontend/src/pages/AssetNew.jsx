import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api.js';
import { Card, ErrorBox, Field, Page } from '../components.jsx';

export default function AssetNew() {
  const navigate = useNavigate();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ type: 'application', name: '', external_id: '', owner: '', members: '', data: '{\n  "criticality": "high"\n}' });
  const [newType, setNewType] = useState({ type: '', display_name: '' });
  const [error, setError] = useState(null);

  useEffect(() => { get('/api/asset-types').then((r) => setTypes(r.items)).catch(setError); }, []);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    let data;
    try { data = form.data.trim() ? JSON.parse(form.data) : {}; } catch { setError(new Error('Data must be valid JSON')); return; }
    try {
      const r = await post('/api/assets', {
        type: form.type, name: form.name, external_id: form.external_id || undefined, owner: form.owner || undefined,
        members: form.members.split(/[,\n]/).map((s) => s.trim()).filter(Boolean), data,
      });
      navigate(`/assets/${r.id}`);
    } catch (err) { setError(err); }
  };

  const addType = async () => {
    try {
      const t = await post('/api/asset-types', newType);
      setTypes([...types, { ...t, asset_count: 0 }]);
      setForm({ ...form, type: t.type });
      setNewType({ type: '', display_name: '' });
    } catch (err) { setError(err); }
  };

  return (
    <Page title="Register asset" subtitle="For assets no connector collects, such as applications. Scripts can POST the same shape to /api/assets/ingest."
      crumbs={[{ to: '/assets', label: 'Assets' }, { label: 'Register' }]}>
      <form onSubmit={save}>
        <Card>
          <div className="form-grid">
            <Field label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {types.map((t) => <option key={t.type} value={t.type}>{t.display_name}</option>)}
              </select>
            </Field>
            <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="External id" hint="Optional stable id; defaults to manual:<type>:<name>"><input value={form.external_id} onChange={(e) => setForm({ ...form, external_id: e.target.value })} /></Field>
            <Field label="Owner"><input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field>
          </div>
          <Field label="Members" hint="Comma or newline separated"><textarea rows={2} value={form.members} onChange={(e) => setForm({ ...form, members: e.target.value })} /></Field>
          <Field label="Data (JSON)" hint="Available to Rego as input.data"><textarea className="mono" rows={8} value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></Field>
        </Card>
        <Card title="New asset type">
          <div className="form-grid">
            <Field label="Type id" hint="snake_case, e.g. cloud_account"><input value={newType.type} onChange={(e) => setNewType({ ...newType, type: e.target.value })} /></Field>
            <Field label="Display name"><input value={newType.display_name} onChange={(e) => setNewType({ ...newType, display_name: e.target.value })} /></Field>
            <div className="field"><span className="field-label">&nbsp;</span><button type="button" className="btn" disabled={!newType.type || !newType.display_name} onClick={addType}>Add type</button></div>
          </div>
        </Card>
        <ErrorBox error={error} />
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn primary">Register</button>
        </div>
      </form>
    </Page>
  );
}
