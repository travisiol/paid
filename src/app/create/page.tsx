import type { Metadata } from "next";
import { CreateFlow } from "@/components/create/CreateFlow";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Create a payment link" };

export default function CreatePage() {
  return (
    <>
      <SiteHeader />
      <main className="shell pt-10 pb-20 lg:pt-14 lg:pb-28">
        <CreateFlow />
      </main>
      <SiteFooter />
    </>
  );
}
