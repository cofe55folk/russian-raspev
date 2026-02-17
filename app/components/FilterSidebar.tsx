type FilterSidebarProps = {
  groups: Array<{
    title: string;
    items: string[];
  }>;
};

export default function FilterSidebar({ groups }: FilterSidebarProps) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-lg font-semibold text-zinc-800">Поиск</div>
        <input
          className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400"
          placeholder="Поиск"
        />
      </div>

      {groups.map((group) => (
        <div key={group.title}>
          <div className="mb-2 text-lg font-semibold text-zinc-800">{group.title}</div>
          <ul className="space-y-1 text-sm text-zinc-700">
            {group.items.map((item) => (
              <li key={item} className="rounded px-2 py-1 hover:bg-[#6b90b8] hover:text-white">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
