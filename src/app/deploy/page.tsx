import type { Metadata } from "next";
import { DeployPanel } from "@/components/deploy/DeployPanel";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Settlement contract" };

export default function DeployPage() {
  return (
    <>
      <SiteHeader />
      <main className="shell pt-10 pb-20 lg:pt-14 lg:pb-28">
        <div className="mx-auto max-w-[760px]">
          <p className="eyebrow">Settlement contract</p>
          <h1 className="heading mt-3">The contract that splits each payment.</h1>
          <p className="lede mt-5">
            When a client pays, this contract takes their USDG, sends the dollar part to the recipient and converts the rest into the
            recipient’s stock tokens, in one transaction. It never holds funds. It has to exist on the network once; anyone can put it there.
          </p>
          <div className="mt-10">
            <DeployPanel />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
