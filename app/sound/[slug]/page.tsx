import PageHero from "../../components/PageHero";
import SoundCardPlayerSlot from "../../components/SoundCardPlayerSlot";
import SongTabs from "../../components/SongTabs";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function SoundTrackPage({ params }: Props) {
  const { slug } = await params;
  const title = decodeURIComponent(slug).replace(/-/g, " ");
  const normalizedTitle = title.charAt(0).toUpperCase() + title.slice(1);

  return (
    <main className="bg-[#f1f1f1] pb-10 text-zinc-900">
      <PageHero title={normalizedTitle} />
      <section className="rr-container">
        <SoundCardPlayerSlot slug={slug} />
      </section>
      <SongTabs showPlayer={false} communityContentId={slug} communityContentTitle={normalizedTitle} />
    </main>
  );
}
