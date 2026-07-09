import { FormEvent, useMemo, useState, type ReactNode, type SVGProps } from "react";

type Tab = "sala" | "cola" | "chat";
type VoteDirection = "up" | "down";

type Proposal = {
  id: number;
  title: string;
  artist: string;
  by: string;
  duration: string;
  up: number;
  down: number;
};

type Message = {
  id: number;
  user: string;
  text: string;
  tone: "host" | "user" | "system";
};

const initialProposals: Proposal[] = [
  {
    id: 1,
    title: "Accidentally in Love",
    artist: "Counting Crows",
    by: "fenix",
    duration: "3:08",
    up: 8,
    down: 1,
  },
  {
    id: 2,
    title: "Everything Goes On",
    artist: "Porter Robinson",
    by: "Luis",
    duration: "3:22",
    up: 6,
    down: 0,
  },
  {
    id: 3,
    title: "Bohemian Rhapsody",
    artist: "Queen",
    by: "Vicky",
    duration: "5:55",
    up: 12,
    down: 2,
  },
];

const initialMessages: Message[] = [
  { id: 1, user: "Sistema", text: "Letra sincronizada para la sala 1.", tone: "system" },
  { id: 2, user: "fenix", text: "Bajen a -150 ms si sienten eco.", tone: "host" },
  { id: 3, user: "Luis", text: "Entro en el coro, listo.", tone: "user" },
];

const queue = [
  "Love of My Life - Queen",
  "Sweet Child O' Mine - Guns N' Roses",
  "Vivir Mi Vida - Marc Anthony",
];

const singers = [
  { name: "Luis", role: "voz lider", color: "from-fuchsia-500 to-cyan-400", active: true },
  { name: "fenix", role: "host", color: "from-amber-400 to-rose-500", active: false },
  { name: "Mia", role: "coro", color: "from-indigo-400 to-violet-500", active: false },
];

const lyricLines = [
  "Is this the real life",
  "Is this just fantasy",
  "Caught in a landslide",
  "No escape from reality",
];

const voiceModes = ["Minimo", "Coro", "Auto"];

function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 10.8a7 7 0 0 0 14 0M12 18v3M8.5 21h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M8 8h8v8H8z" fill="currentColor" />
    </svg>
  );
}

function MusicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M9 18.5a2.5 2.5 0 1 1-2-2.45V6.5l10-2v10a2.5 2.5 0 1 1-2-2.45V8.2l-6 1.2v9.1Z" fill="currentColor" />
    </svg>
  );
}

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H12l-4.5 4v-4A3.5 3.5 0 0 1 5 10.5v-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function QueueIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M5 7h14M5 12h10M5 17h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m16 15 3 2-3 2v-4Z" fill="currentColor" />
    </svg>
  );
}

function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m4 12 15-7-4 14-3.2-5.2L4 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m12 13.8 7-8.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SignalBars() {
  return (
    <div className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {[5, 9, 13, 17].map((height) => (
        <span key={height} className="w-1 rounded-full bg-emerald-300" style={{ height }} />
      ))}
    </div>
  );
}

function Equalizer() {
  return (
    <div className="flex h-7 items-end gap-1" aria-label="Audio activo">
      {[0, 1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className="equalizer-bar w-1.5 rounded-full bg-violet-300"
          style={{ animationDelay: `${bar * 120}ms` }}
        />
      ))}
    </div>
  );
}

function ProposalCard({ proposal, onVote }: { proposal: Proposal; onVote: (id: number, direction: VoteDirection) => void }) {
  return (
    <article className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.04]">
      <div className="relative h-20 bg-[linear-gradient(135deg,rgba(130,101,255,.22),rgba(18,21,35,.92)),repeating-linear-gradient(45deg,rgba(255,255,255,.06)_0_7px,transparent_7px_16px)]">
        <div className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-violet-100 ring-1 ring-white/15">
          <MusicIcon className="h-5 w-5" />
        </div>
        <span className="absolute bottom-3 right-3 rounded-full bg-black/35 px-2 py-1 text-[10px] font-bold text-white/80">
          {proposal.duration}
        </span>
      </div>
      <div className="space-y-3 p-3">
        <div>
          <h3 className="line-clamp-1 text-sm font-black text-white">{proposal.title}</h3>
          <p className="line-clamp-1 text-xs font-semibold text-slate-400">{proposal.artist}</p>
          <p className="mt-1 text-[11px] text-slate-500">propone {proposal.by}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onVote(proposal.id, "up")}
            className="rounded-xl bg-emerald-400/15 py-2 text-xs font-black text-emerald-200 transition hover:bg-emerald-400/25 active:scale-95"
          >
            + {proposal.up}
          </button>
          <button
            onClick={() => onVote(proposal.id, "down")}
            className="rounded-xl bg-white/7 py-2 text-xs font-black text-slate-300 transition hover:bg-white/12 active:scale-95"
          >
            - {proposal.down}
          </button>
        </div>
      </div>
    </article>
  );
}

function SingerAvatar({ singer }: { singer: (typeof singers)[number] }) {
  return (
    <div className="min-w-20 text-center">
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${singer.color} p-0.5 ${singer.active ? "pulse-ring" : ""}`}>
        <div className="flex h-full w-full items-center justify-center rounded-full bg-[#141622] text-lg font-black text-white">
          {singer.name.charAt(0)}
        </div>
      </div>
      <p className="mt-2 text-xs font-black text-white">{singer.name}</p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{singer.role}</p>
    </div>
  );
}

function RoomTab({ mode, setMode }: { mode: string; setMode: (mode: string) => void }) {
  return (
    <div className="space-y-5">
      <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Modo de voz</p>
            <h2 className="mt-1 text-lg font-black text-white">Canta con baja latencia</h2>
          </div>
          <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-200">150 ms</div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {voiceModes.map((item) => (
            <button
              key={item}
              onClick={() => setMode(item)}
              className={`rounded-2xl py-3 text-xs font-black transition active:scale-95 ${
                mode === item ? "bg-violet-500 text-white shadow-lg shadow-violet-950/40" : "bg-white/7 text-slate-400"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-400">
            <span>Retardo local</span>
            <span className="text-white">-150 ms</span>
          </div>
          <input className="w-full accent-violet-400" type="range" min="-300" max="300" defaultValue="-150" />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-300">En vivo</p>
            <h2 className="text-lg font-black text-white">Cantantes en sala</h2>
          </div>
          <button className="rounded-full border border-white/10 px-3 py-2 text-xs font-black text-slate-300 transition hover:bg-white/10 active:scale-95">
            Invitar
          </button>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {singers.map((singer) => (
            <SingerAvatar key={singer.name} singer={singer} />
          ))}
        </div>
      </section>
    </div>
  );
}

function QueueTab({ proposals, onVote, onAdd }: { proposals: Proposal[]; onVote: (id: number, direction: VoteDirection) => void; onAdd: (title: string) => void }) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;
    onAdd(draft.trim());
    setDraft("");
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="flex gap-2 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Pega un link o escribe una cancion"
          className="min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-white outline-none placeholder:text-slate-600"
        />
        <button className="rounded-2xl bg-violet-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-violet-950/40 transition active:scale-95">
          Proponer
        </button>
      </form>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">La sala vota</p>
            <h2 className="text-lg font-black text-white">Propuestas</h2>
          </div>
          <p className="text-xs font-bold text-slate-500">mayoria decide</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {proposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} onVote={onVote} />
          ))}
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-dashed border-white/15 p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">A continuacion</p>
        <div className="mt-3 space-y-3">
          {queue.map((song, index) => (
            <div key={song} className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/7 text-xs font-black text-slate-400">{index + 1}</span>
              <p className="text-sm font-bold text-slate-300">{song}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChatTab({ messages, onSend }: { messages: Message[]; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft("");
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Chat de sala</p>
            <h2 className="text-lg font-black text-white">Mensajes en vivo</h2>
          </div>
          <SignalBars />
        </div>
        <div className="mt-4 space-y-3">
          {messages.map((message) => (
            <div key={message.id} className="flex gap-3">
              <div
                className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  message.tone === "host" ? "bg-amber-400 text-slate-950" : message.tone === "system" ? "bg-violet-400/20 text-violet-200" : "bg-white/10 text-white"
                }`}
              >
                {message.user.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-300">{message.user}</p>
                <p className="text-sm leading-relaxed text-slate-400">{message.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <form onSubmit={handleSubmit} className="flex gap-2 rounded-[1.5rem] border border-white/10 bg-[#151825] p-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Escribe un mensaje"
          className="min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-white outline-none placeholder:text-slate-600"
        />
        <button className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500 text-white transition active:scale-95" aria-label="Enviar mensaje">
          <SendIcon className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: "sala", label: "Sala", icon: <MicIcon className="h-5 w-5" /> },
    { id: "cola", label: "Cola", icon: <QueueIcon className="h-5 w-5" /> },
    { id: "chat", label: "Chat", icon: <ChatIcon className="h-5 w-5" /> },
  ];

  return (
    <nav className="absolute inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0c0e16]/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl">
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`flex flex-col items-center gap-1 rounded-2xl py-2 text-xs font-black transition active:scale-95 ${
              tab === item.id ? "bg-violet-500 text-white shadow-lg shadow-violet-950/40" : "text-slate-500 hover:bg-white/7 hover:text-slate-200"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("sala");
  const [mode, setMode] = useState("Coro");
  const [muted, setMuted] = useState(false);
  const [proposals, setProposals] = useState(initialProposals);
  const [messages, setMessages] = useState(initialMessages);

  const totalVotes = useMemo(() => proposals.reduce((total, proposal) => total + proposal.up - proposal.down, 0), [proposals]);

  function handleVote(id: number, direction: VoteDirection) {
    setProposals((current) =>
      current.map((proposal) =>
        proposal.id === id
          ? {
              ...proposal,
              up: direction === "up" ? proposal.up + 1 : proposal.up,
              down: direction === "down" ? proposal.down + 1 : proposal.down,
            }
          : proposal,
      ),
    );
  }

  function handleAddProposal(title: string) {
    setProposals((current) => [
      {
        id: Date.now(),
        title,
        artist: "Propuesta de la sala",
        by: "tu",
        duration: "4:00",
        up: 1,
        down: 0,
      },
      ...current,
    ]);
    setTab("cola");
  }

  function handleSendMessage(text: string) {
    setMessages((current) => [...current, { id: Date.now(), user: "tu", text, tone: "user" }]);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#070810] text-white selection:bg-violet-400/40">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(124,58,237,.22),transparent_30%),radial-gradient(circle_at_85%_0%,rgba(20,184,166,.14),transparent_28%),linear-gradient(180deg,#0b0d17_0%,#070810_100%)]" />

      <section className="relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#0e1018] shadow-2xl shadow-black/50 sm:my-6 sm:h-[900px] sm:rounded-[2.25rem] sm:ring-1 sm:ring-white/10">
        <header className="relative z-20 border-b border-white/10 bg-[#10121c]/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.85rem)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-violet-700 text-xl font-black shadow-lg shadow-violet-950/50">V</div>
              <div>
                <p className="text-sm font-black tracking-tight text-white">Karaoke Sin Delay</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,.8)]" />
                  <span>Sala 1</span>
                  <span className="text-slate-600">/</span>
                  <span>ping 1 ms</span>
                </div>
              </div>
            </div>
            <button className="rounded-xl border border-rose-400/30 px-3 py-2 text-xs font-black text-rose-200 transition hover:bg-rose-400/10 active:scale-95">Salir</button>
          </div>
        </header>

        <div className="relative flex-1 overflow-y-auto pb-28">
          <section className="px-4 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-violet-300">Sonando ahora</p>
                <h1 className="mt-1 max-w-[290px] text-xl font-black leading-tight tracking-tight text-white">Queen - Bohemian Rhapsody</h1>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-white">1</p>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">Sync</p>
              </div>
            </div>

            <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(124,58,237,.35),rgba(15,23,42,.75)),repeating-linear-gradient(45deg,rgba(255,255,255,.08)_0_6px,transparent_6px_14px)] text-violet-200">
                  <MusicIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-black text-white">Queen Official Video Remastered</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="progress-sweep h-full w-[38%] rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] font-bold text-slate-500">
                    <span>0:00</span>
                    <span>5:55</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500 text-white shadow-lg shadow-violet-950/40 transition active:scale-95" aria-label="Reproducir">
                    <PlayIcon className="h-5 w-5" />
                  </button>
                  <button className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/7 text-slate-300 transition active:scale-95" aria-label="Detener">
                    <StopIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="relative mt-4 overflow-hidden bg-black">
            <div className="relative aspect-[9/13] min-h-[430px] overflow-hidden">
              <img src="/images/karaoke-stage.jpg" alt="Escenario de karaoke con luces violeta" className="absolute inset-0 h-full w-full object-cover opacity-75" />
              <div className="stage-glow absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(168,85,247,.2),transparent_35%),linear-gradient(180deg,rgba(0,0,0,.1)_0%,rgba(7,8,16,.78)_78%,#0e1018_100%)]" />

              <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/60">Vista karaoke</p>
                  <h2 className="mt-1 max-w-64 text-lg font-black leading-tight text-white drop-shadow">No escape from reality</h2>
                </div>
                <button className="flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-amber-200 backdrop-blur-md ring-1 ring-white/10" aria-label="Favorito">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
                  </svg>
                </button>
              </div>

              <div className="absolute inset-x-4 bottom-28 rounded-[1.6rem] border border-white/10 bg-black/35 p-4 backdrop-blur-md">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Letra sincronizada</span>
                  <Equalizer />
                </div>
                <div className="space-y-2">
                  {lyricLines.map((line, index) => (
                    <p
                      key={line}
                      className={`lyric-line text-center font-black tracking-tight ${
                        index === 1 ? "active text-2xl text-white" : "text-base text-white/45"
                      }`}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>

              <div className="absolute inset-x-4 bottom-5 flex items-center gap-3">
                <button
                  onClick={() => setMuted((current) => !current)}
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition active:scale-95 ${
                    muted ? "border-rose-300/30 bg-rose-400/15 text-rose-200" : "border-white/10 bg-white/10 text-white"
                  }`}
                  aria-label={muted ? "Activar microfono" : "Silenciar microfono"}
                >
                  <MicIcon className="h-5 w-5" />
                </button>
                <button className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-4 text-sm font-black text-white shadow-xl shadow-violet-950/50 transition active:scale-[0.98]">
                  <MicIcon className="h-5 w-5" />
                  Cantar ahora
                </button>
                <button onClick={() => setTab("cola")} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-white transition active:scale-95" aria-label="Abrir cola">
                  <QueueIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-5 px-4 py-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[1.2rem] bg-white/[0.04] p-3 ring-1 ring-white/10">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Modo</p>
                <p className="mt-1 text-sm font-black text-white">{mode}</p>
              </div>
              <div className="rounded-[1.2rem] bg-white/[0.04] p-3 ring-1 ring-white/10">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Votos</p>
                <p className="mt-1 text-sm font-black text-white">{totalVotes}</p>
              </div>
              <div className="rounded-[1.2rem] bg-white/[0.04] p-3 ring-1 ring-white/10">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Audio</p>
                <p className="mt-1 text-sm font-black text-white">{muted ? "Mute" : "Live"}</p>
              </div>
            </div>

            {tab === "sala" && <RoomTab mode={mode} setMode={setMode} />}
            {tab === "cola" && <QueueTab proposals={proposals} onVote={handleVote} onAdd={handleAddProposal} />}
            {tab === "chat" && <ChatTab messages={messages} onSend={handleSendMessage} />}
          </section>
        </div>

        <BottomNav tab={tab} setTab={setTab} />
      </section>
    </main>
  );
}