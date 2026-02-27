import { CollabRoomFeedbackTimelineClient } from "../../../components/community/CollabRoomFeedbackTimelineClient";

type RoomPageProps = {
  params: Promise<{ roomId: string }>;
};

export default async function CommunityRoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <CollabRoomFeedbackTimelineClient roomId={roomId} />
    </main>
  );
}
