import { Layers3 } from 'lucide-react'
import type { navigation } from '../../app/navigation'

export function ModulePage({ item }: { item: typeof navigation[number] }) {
  const Icon = item.icon
  return <><div className="toolbar"><div><span className="eyebrow">{item.group}</span><h1>{item.title}</h1><p>{item.description}</p></div><span className="badge neutral">Fase {item.phase}</span></div><section className="panel module-placeholder"><span className="module-icon"><Icon size={32} /></span><h2>Espaço preparado para {item.title.toLocaleLowerCase('pt-BR')}</h2><p>Este módulo será implementado na Fase {item.phase}, seguindo a especificação da OPTOCOM Visão.</p><div className="module-footnote"><Layers3 size={16} /> A navegação está pronta. As operações serão adicionadas na etapa correspondente.</div></section></>
}
