import Image from "next/image";

type MediaCardProps = {
  title: string;
  description: string;
};

export default function MediaCard({ title, description }: MediaCardProps) {
  return (
    <article className="space-y-2">
      <div className="relative h-48 overflow-hidden rounded-lg">
        <Image src="/hero.jpg" alt={title} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
        <div className="absolute inset-0 bg-black/30" />
        <button className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#6b90b8] text-white">
          ▶
        </button>
      </div>
      <div className="text-xs text-zinc-500">❤ 234 • 👁 34</div>
      <h3 className="text-xl font-semibold text-zinc-800">{title}</h3>
      <p className="text-sm leading-6 text-zinc-600">{description}</p>
    </article>
  );
}
