'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowRight, AudioLines, Mic, FileText, Layers, Scissors, Code2, Cpu, ShieldCheck, FolderOpen, Headphones, Activity } from 'lucide-react'
import { api } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { GenerationJobOut } from '@/types/api'

const features = [
    { title: 'Text to speech', desc: 'Transform scripts into expressive audio with local speech models.', href: '/studio', icon: AudioLines, tag: 'CREATE' },
    { title: 'Private voice cloning', desc: 'Build a reusable voice from an authorized reference recording.', href: '/voice-cloning', icon: Mic, tag: 'PERSONALIZE' },
    { title: 'Speech to text', desc: 'Transcribe recordings, identify speakers and export subtitles.', href: '/transcriptions', icon: FileText, tag: 'UNDERSTAND' },
    { title: 'Audio projects', desc: 'Produce dialogue, narration and timestamp-aligned dubbing.', href: '/projects', icon: Layers, tag: 'PRODUCE' },
    { title: 'Audio editing', desc: 'Trim, combine, normalize and export your recordings.', href: '/audio-tools', icon: Scissors, tag: 'REFINE' },
    { title: 'Developer API', desc: 'Integrate local speech workflows into internal applications.', href: '/developer', icon: Code2, tag: 'INTEGRATE' },
]
const flows = [
    { name: 'Generate speech', steps: ['Write or import a script', 'Choose a model and voice', 'Generate and review audio'], href: '/studio', desc: 'From written words to a reusable audio asset.' },
    { name: 'Clone a voice', steps: ['Upload an authorized recording', 'Extract a private voice profile', 'Select the voice in Studio'], href: '/voice-cloning', desc: 'Create a private voice with explicit speaker consent.' },
    { name: 'Transcribe audio', steps: ['Upload or select a recording', 'Choose language and speaker options', 'Edit and export the transcript'], href: '/transcriptions', desc: 'Turn recorded conversations into editable text.' },
]
function Wave({ bars = 64 }: { bars?: number }) {
    return (
        <div className="corp-wave" aria-hidden="true">
            {Array.from({ length: bars }, (_, i) => {
                const height = 12 + 75 * Math.abs(
                    Math.sin(i * 0.24) * Math.cos(i * 0.091)
                );

                const delay = -i * 0.075;

                return (
                    <i
                        key={i}
                        style={{
                            height: `${height.toFixed(4)}%`,
                            animationDelay: `${delay.toFixed(4)}s`,
                        }}
                    />
                );
            })}
        </div>
    );
}


export default function DashboardPage() {
    const [jobs, setJobs] = useState<GenerationJobOut[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [tab, setTab] = useState(0)
    useEffect(() => { let active = true, busy = false; async function load() { if (busy) return; busy = true; try { const rows = await api.generations.list(5); if (active) { setJobs(rows); setError('') } } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Unable to load activity') } finally { busy = false; if (active) setLoading(false) } } void load(); const timer = setInterval(() => void load(), 5000); return () => { active = false; clearInterval(timer) } }, [])
    const flow = flows[tab]
    return <div className="corp-home">
        <section className="corp-hero"><svg className="corp-ribbons" viewBox="0 0 1200 560" preserveAspectRatio="none" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <path key={i} d={`M-100 ${300 + i * 9} C 240 ${-100 + i * 18}, 510 ${680 - i * 12}, 820 ${310 + i * 4} S 1110 ${-100 + i * 16}, 1350 ${100 + i * 12}`} fill="none" stroke="currentColor" strokeWidth="1" />)}</svg><div className="corp-hero-copy"><span className="corp-kicker"><span className="corp-dot" /> YOUR LOCAL AI AUDIO WORKSPACE</span><h1>Give your ideas<br /> a <em>voice.</em></h1><p>One intelligent workspace to create, clone, understand and refine audio. Built for your team, powered by models running on your own machine.</p><div className="corp-actions"><Link className="corp-primary" href="/studio">Open Studio <ArrowUpRight size={19} /></Link><a className="corp-secondary" href="#capabilities">Explore capabilities <ArrowRight size={17} /></a></div><div className="corp-trust"><ShieldCheck size={17} /> Local inference <span>·</span> <Cpu size={17} /> Multi-model architecture</div></div><div className="corp-hero-visual"><div className="corp-orbit corp-orbit-one" /><div className="corp-orbit corp-orbit-two" /><div className="corp-signal"><div className="corp-signal-top"><AudioLines size={24} /><span>VOICE STUDIO</span><span className="corp-demo-label">Illustration</span></div><Wave /><div className="corp-signal-bottom"><span>Text → Voice → Audio</span><Headphones size={22} /></div></div><div className="corp-float corp-float-top"><Mic size={20} /> Voice intelligence</div><div className="corp-float corp-float-bottom"><Cpu size={20} /> Local processing</div></div></section>
        <section className="corp-strip">{[['03', 'Speech engines'], ['01', 'Unified workspace'], ['Local', 'Inference execution'], ['API', 'Application integration']].map(([n, l]) => <div key={l}><strong>{n}</strong><span>{l}</span></div>)}</section>
        <section id="capabilities" className="corp-section"><div className="corp-section-head"><div><span className="corp-kicker">THE PLATFORM</span><h2>Everything audio.<br /><em>One workspace.</em></h2></div><p>From the first line of a script to the final recording, bring your entire audio production workflow together.</p></div><div className="corp-feature-grid">{features.map(({ title, desc, href, icon: Icon, tag }, i) => <Link key={href} href={href} className={`corp-feature ${i === 0 ? 'corp-feature-dark' : ''}`}><div className="corp-feature-top"><span className="corp-icon"><Icon size={25} /></span><ArrowUpRight size={20} /></div><span className="corp-kicker">{tag}</span><h3>{title}</h3><p>{desc}</p>{i === 0 ? <Wave bars={32} /> : <span className="corp-feature-link">Explore tool <ArrowRight size={16} /></span>}</Link>)}</div></section>
        <section className="corp-workflow corp-section"><div className="corp-section-head"><div><span className="corp-kicker">HOW IT WORKS</span><h2>From input to <em>impact.</em></h2></div><p>Choose a workflow to see how the platform turns your input into a usable result.</p></div><div className="corp-tabs" aria-label="Workflow examples">{flows.map((f, i) => <button key={f.name} aria-pressed={tab === i} onClick={() => setTab(i)}>{f.name}</button>)}</div><div className="corp-flow" key={tab}><div><span className="corp-kicker">WORKFLOW / 0{tab + 1}</span><h3>{flow.name}</h3><p>{flow.desc}</p><Link href={flow.href} className="corp-primary">Start workflow <ArrowUpRight size={17} /></Link></div><ol>{flow.steps.map((s, i) => <li key={s}><span>0{i + 1}</span><strong>{s}</strong><ArrowRight size={17} /></li>)}</ol></div></section>
        <section className="corp-engine corp-section"><div><span className="corp-kicker">BUILT FOR LOCAL AI</span><h2>Powerful models.<br /> Your own machine.</h2><p>Choose between Piper, Kokoro and Qwen MNN according to your workload. A shared inference queue coordinates speech generation, extraction and transcription.</p><div className="corp-actions"><Link className="corp-secondary" href="/models">Explore models <ArrowUpRight size={17} /></Link><Link className="corp-secondary" href="/queue">Job queue <Activity size={17} /></Link></div></div><div className="corp-engine-stack">{['Piper · lightweight speech', 'Kokoro · neural speech', 'Qwen MNN · voice cloning'].map((s, i) => <div key={s}><Cpu size={24} /><span>{s}</span><span>0{i + 1}</span></div>)}</div></section>
        <section className="corp-section corp-recent"><div className="corp-section-head"><div><span className="corp-kicker">YOUR WORKSPACE</span><h2>Pick up where you left off.</h2></div><Link className="corp-secondary" href="/jobs">View history <ArrowRight size={17} /></Link></div>{error && <p role="alert" className="text-danger">{error}</p>}{loading ? <p>Loading activity…</p> : jobs.length === 0 ? <p>No recent generations. Start in Studio.</p> : jobs.map(j => <article key={j.id}><span className="corp-icon"><AudioLines size={21} /></span><div className="corp-job-text"><strong>{j.text.slice(0, 160)}</strong><small>{j.status} · {formatRelativeTime(j.created_at)}</small></div><div className="corp-actions"><Link href={`/studio?reuse=${j.id}`}>Reuse script</Link>{j.audio_asset_id && <Link href={`/audio-library?asset=${j.audio_asset_id}`}>Play audio</Link>}</div></article>)}</section><footer className="corp-footer"><AudioLines size={23} /><strong>AI Voice Studio</strong><span>Local audio production workspace | Desgined And Developed by Manjunath Kaaluru</span><Link href="/projects"><FolderOpen size={17} /> Projects</Link></footer>
    </div>
}
