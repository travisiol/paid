import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="shell py-24 text-center">
        <p className="eyebrow">Not found</p>
        <h1 className="heading mt-3">This link does not exist.</h1>
        <p className="lede mx-auto mt-5 max-w-[44ch]">
          Check the address you were sent.
        </p>
        <Link href="/" className="btn btn-ink mt-8">
          Back to paid
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
