import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/home";
import { SplashScreen } from "../components/splash-screen";
import { getOptionalUser } from "~/lib/session.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "YADAH Dynamic Enterprise" },
    { name: "description", content: "Susu · Savings · Loans" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getOptionalUser(request);
  return { target: user ? "/dashboard" : "/login" };
}

export default function Home() {
  const { target } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <SplashScreen onDone={() => navigate(target, { replace: true })} />
  );
}
