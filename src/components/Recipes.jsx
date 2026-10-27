import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, ChefHat, Plus, Trash2, X } from 'lucide-react'
import api from '../lib/api.js'
import './branches.css'

const money = (n) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n || 0)
const blankForm = { name: '', outputItem: '', deductMode: 'INGREDIENTS', notes: '', ingredients: [{ item: '', quantity: '' }] }

/**
 * Recipes / Bill of Materials (v3).
 * When a finished item with a recipe is DELIVERED, raw materials deduct
 * automatically (INGREDIENTS mode) or alongside the finished item (BOTH).
 * Cost per unit is computed live from each ingredient's latest purchase cost.
 */
export default function Recipes({ user, logout }) {
  const [recipes, setRecipes] = useState([])
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)
  const [editId, setEditId] = useState(null)

  const load = useCallback(async () => {
    try {
      const [r, inv] = await Promise.all([api.get('/recipes'), api.get('/inventory/items', { params: { limit: 500 } })])
      setRecipes(r.data.recipes)
      setItems(inv.data.items || inv.data || [])
      setError('')
    } catch (e) { setError(e.response?.data?.message || 'Unable to load recipes.') }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (e) => {
    e.preventDefault()
    const payload = { ...form, ingredients: form.ingredients.filter((i) => i.item).map((i) => ({ item: i.item, quantity: Number(i.quantity) })) }
    try {
      if (editId) await api.patch(`/recipes/${editId}`, payload)
      else await api.post('/recipes', payload)
      setForm(null); setEditId(null); load()
    } catch (err) { setError(err.response?.data?.message || 'Could not save recipe.') }
  }

  const remove = async (id, name) => {
    if (!window.confirm(`Delete recipe "${name}"? Future deliveries will no longer deduct its ingredients.`)) return
    try { await api.delete(`/recipes/${id}`); load() } catch (err) { setError(err.response?.data?.message || 'Could not delete recipe.') }
  }

  const openEdit = (r) => {
    setEditId(r._id)
    setForm({
      name: r.name, outputItem: r.outputItem?._id || r.outputItem, deductMode: r.deductMode, notes: r.notes || '',
      ingredients: r.ingredients.map((i) => ({ item: i.item?._id || i.item, quantity: i.quantity })),
    })
  }

  return (
    <div className="branches-page">
      <header>
        <button onClick={() => history.back()}><ArrowLeft size={18} />Dashboard</button>
        <div><b>AL KAUSAR BAKREY</b><span>Recipes & Costing</span></div>
        <button onClick={logout}>Sign out</button>
      </header>
      <main>
        <div className="branches-title">
          <div><p>RECIPE / BOM</p><h1>Recipes & Ingredient Costing</h1><span>Sell a cake — flour, sugar and butter deduct themselves.</span></div>
          <button className="branches-primary" onClick={() => { setEditId(null); setForm({ ...blankForm, ingredients: [{ item: '', quantity: '' }] }) }}><Plus size={17} />New Recipe</button>
        </div>

        {error && <div className="branches-error"><AlertCircle size={18} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}

        <section className="branches-panel">
          <div className="branches-table" style={{ marginTop: 0 }}>
            <table><thead><tr><th>Recipe</th><th>Finished Item</th><th>Mode</th><th>Ingredients (per unit)</th><th>Food Cost / Unit</th><th></th></tr></thead>
              <tbody>
                {recipes.map((r) => (
                  <tr key={r._id}>
                    <td><b>{r.name}</b>{r.notes && <small style={{ display: 'block', color: '#5b6b5b' }}>{r.notes}</small>}</td>
                    <td>{r.outputItem?.itemName}</td>
                    <td>{r.deductMode}</td>
                    <td>{r.ingredients.map((i, ix) => <span key={ix} style={{ display: 'block' }}>{i.item?.itemName}: {i.quantity} {i.item?.unit} ({money(i.lineCost)})</span>)}</td>
                    <td><b>{money(r.costPerUnit)}</b></td>
                    <td><button onClick={() => openEdit(r)}>Edit</button> <button onClick={() => remove(r._id, r.name)} aria-label="Delete recipe"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
                {!recipes.length && <tr><td colSpan="6">No recipes yet. Create one to automate raw-material deduction.</td></tr>}
              </tbody></table>
          </div>
          <p className="branches-note"><ChefHat size={13} /> INGREDIENTS mode: only raw materials deduct on delivery (made-to-order). BOTH: the finished item and its ingredients deduct. FINISHED: no BOM behaviour.</p>
        </section>

        {form && (
          <div className="branches-back" onMouseDown={() => setForm(null)}>
            <section className="branches-modal" style={{ width: 'min(560px, 94vw)' }} onMouseDown={(e) => e.stopPropagation()}>
              <div className="branches-modal-head"><h2>{editId ? 'Edit Recipe' : 'New Recipe'}</h2><button onClick={() => setForm(null)}><X /></button></div>
              <form className="branches-modal-form" onSubmit={save}>
                <label>Recipe Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chocolate Cake" /></label>
                <label>Finished Item (output)<select required value={form.outputItem} onChange={(e) => setForm({ ...form, outputItem: e.target.value })}><option value="">Select item</option>{items.map((i) => <option key={i._id} value={i._id}>{i.itemName} ({i.unit})</option>)}</select></label>
                <label>Deduction Mode<select value={form.deductMode} onChange={(e) => setForm({ ...form, deductMode: e.target.value })}><option value="INGREDIENTS">Ingredients only</option><option value="BOTH">Finished item + ingredients</option><option value="FINISHED">Finished item only</option></select></label>
                <div>
                  <b style={{ fontSize: 13 }}>Ingredients — quantity per 1 unit of output</b>
                  {form.ingredients.map((row, ix) => (
                    <div key={ix} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <select required value={row.item} onChange={(e) => { const next = [...form.ingredients]; next[ix] = { ...row, item: e.target.value }; setForm({ ...form, ingredients: next }) }} style={{ flex: 2, border: '1px solid #c9d2bf', borderRadius: 8, padding: '8px 10px' }}><option value="">Select ingredient</option>{items.map((i) => <option key={i._id} value={i._id}>{i.itemName} ({i.unit})</option>)}</select>
                      <input required type="number" min="0.0001" step="any" placeholder="Qty" value={row.quantity} onChange={(e) => { const next = [...form.ingredients]; next[ix] = { ...row, quantity: e.target.value }; setForm({ ...form, ingredients: next }) }} style={{ flex: 1, border: '1px solid #c9d2bf', borderRadius: 8, padding: '8px 10px' }} />
                      <button type="button" onClick={() => setForm({ ...form, ingredients: form.ingredients.filter((_, i) => i !== ix) })}><X size={15} /></button>
                    </div>
                  ))}
                  <button type="button" style={{ marginTop: 10 }} onClick={() => setForm({ ...form, ingredients: [...form.ingredients, { item: '', quantity: '' }] })}><Plus size={14} /> Add ingredient</button>
                </div>
                <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
                <footer><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="branches-primary">{editId ? 'Save Changes' : 'Create Recipe'}</button></footer>
              </form>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
