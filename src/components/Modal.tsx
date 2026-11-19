import {useEffect,useId,useRef,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import './modal.css'
export function Modal({title,children,onClose,busy=false,wide=false}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null),heading=useId(),close=useRef(onClose);close.current=onClose
 useEffect(()=>{
  const dialog=ref.current!,previous=document.activeElement as HTMLElement|null,root=document.documentElement,overflow=root.style.overflow,x=window.scrollX,y=window.scrollY
  dialog.showModal();root.style.overflow='hidden';dialog.querySelector<HTMLElement>('input:not([type=checkbox]):not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus({preventScroll:true})
  let last=''
  const observer=new MutationObserver(()=>{const notice=dialog.querySelector<HTMLElement>('[role=alert],.notice[role=status]');const text=notice?.textContent??'';if(text&&text!==last){notice?.scrollIntoView({block:'nearest'});last=text}})
  observer.observe(dialog,{childList:true,subtree:true,characterData:true})
  return()=>{observer.disconnect();dialog.close();root.style.overflow=overflow;previous?.focus({preventScroll:true});window.scrollTo(x,y)}
 },[])
 return createPortal(<dialog ref={ref} aria-labelledby={heading} className={`clinic-modal ${wide?'wide':''}`} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busy)close.current()}}><header className="modal-heading"><h2 id={heading}>{title}</h2><button className="button" type="button" disabled={busy} onClick={onClose} aria-label="Fechar janela">Fechar ×</button></header><div className="modal-content" aria-busy={busy}>{children}</div></dialog>,document.body)
}
