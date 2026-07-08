import ViewerExperience from "@/components/ViewerExperience";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ sceneId: string }>;
};

export default async function ViewerPage({ params }: Props) {
  const { sceneId } = await params;
  return <ViewerExperience sceneId={sceneId} />;
}
