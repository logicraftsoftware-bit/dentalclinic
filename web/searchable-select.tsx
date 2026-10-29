import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

type Option = { value: string; label: string; group: string };

export function SearchableSelect({ label, placeholder, searchLabel, options, value, onChange }: { label: string; placeholder: string; searchLabel: string; options: Option[]; value: string; onChange: (value: string) => void }) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(-1);
  const choices = options.filter(o => `${o.label} ${o.group}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = options.find(o => o.value === value);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);
  function choose(option: Option) { onChange(option.value); setOpen(false); trigger.current?.focus(); }
  function show() { setQuery(''); setActive(-1); setOpen(true); }
  return <div className="searchable-select" ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <span className="searchable-select-label">Treatment procedure category</span>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox" className="searchable-select-trigger" onClick={() => open ? setOpen(false) : show()} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); } if (e.key === 'Escape') setOpen(false); }}><span>{selected?.label || placeholder}</span><ChevronDown size={18} aria-hidden="true" /></button>
    {open && <div className="searchable-select-popup">
      <div className="searchable-select-search"><Search size={19} aria-hidden="true" /><input ref={search} role="combobox" aria-label={searchLabel} aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={active >= 0 && choices[active] ? `${id}-option-${active}` : undefined} placeholder="Search options..." value={query} onChange={e => { setQuery(e.target.value); setActive(-1); }} onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(current => choices.length ? (current + (e.key === 'ArrowDown' ? 1 : current < 0 ? 0 : -1) + choices.length) % choices.length : -1); }
        if (e.key === 'Enter') { e.preventDefault(); if (choices[active]) choose(choices[active]); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      }} /><button type="button" aria-label={`Clear ${searchLabel}`} className="searchable-select-clear" onClick={() => { setQuery(''); setActive(-1); search.current?.focus(); }}><X size={18} /></button></div>
      <div id={`${id}-list`} role="listbox" aria-label={`${label} options`} className="searchable-select-options">
        {[...new Set(choices.map(o => o.group))].map(group => <div role="group" aria-label={group} key={group}><div className="searchable-select-group" aria-hidden="true">{group}</div>{choices.filter(o => o.group === group).map(option => {
          const index = choices.indexOf(option);
          return <button type="button" role="option" tabIndex={-1} id={`${id}-option-${index}`} aria-selected={option.value === value} className={index === active ? 'is-focused' : ''} key={option.value} onPointerDown={e => e.preventDefault()} onClick={() => choose(option)}><span>{option.label}</span>{option.value === value && <Check size={17} aria-hidden="true" />}</button>;
        })}</div>)}
        {!choices.length && <p role="status">{options.length ? 'No matching procedures. Try another search.' : 'No active procedures in this department.'}</p>}
      </div>
    </div>}
  </div>;
}
