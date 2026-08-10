import type { Metadata } from "next";
import {
  Body,
  ButtonPrimary,
  ButtonSecondary,
  EvidenceRow,
  HairlineCell,
  HairlineGrid,
  Lead,
  Lockup,
  Metric,
  MicroLabel,
  Panel,
  SectionHeading,
  SectionNumber,
} from "@/components/brand";
import { Beam } from "./beam";

export const metadata: Metadata = {
  title: "PursuitOS — Know where revenue moves next.",
  description:
    "PursuitOS scores the intersection of customer, product, partner, seller and timing, then assembles the motion to pursue it.",
};

const NAV = [
  { label: "Platform", href: "#platform" },
  { label: "Ecosystem", href: "#ecosystem" },
  { label: "Evidence", href: "#evidence" },
];

const HERO_METRICS = [
  { value: "41", label: "Evidence sources per pursuit" },
  { value: "0.72", label: "Median confidence at launch" },
  { value: "7", label: "Stages, data to learning" },
  { value: "3.4×", label: "Pipeline per motion vs. baseline" },
];

const CATEGORIES = [
  { name: "CRM", line: "Records what happened." },
  { name: "PRM", line: "Administers partners, portals and deal registration." },
  { name: "Ecosystem maps", line: "Reveal who is connected to whom." },
  {
    name: "PursuitOS",
    line: "Decides what to activate, through whom, with what message, and why now.",
    assertion: true,
  },
];

const ENGINES = [
  { n: "01", name: "Sense", line: "Entity resolution and signal collection across the graph." },
  { n: "02", name: "Predict", line: "Purchase propensity and activation probability." },
  { n: "03", name: "Match", line: "Customer × product × partner × seller." },
  { n: "04", name: "Design", line: "Revenue motions and the campaigns that carry them." },
  { n: "05", name: "Execute", line: "Seller actions and human-approved outreach." },
  { n: "06", name: "Learn", line: "Outcome events become lift, and lift retrains Predict." },
];

const EVIDENCE = [
  { label: "Two senior data platform roles posted, 11d", weight: 0.82 },
  { label: "Legacy warehouse contract renews Q4", weight: 0.68 },
  { label: "Partner closed adjacent motion at 3 peers", weight: 0.59 },
  { label: "CRM: dormant 14 months, no open opp", weight: 0.34 },
];

const TEAM = [
  { name: "Ingram Micro", role: "Distributor · fit 0.91" },
  { name: "Arclight Consulting", role: "SI partner · fit 0.84" },
  { name: "M. Okonjo", role: "Seller · prior win at peer" },
];

const ENGAGEMENT = [
  { k: "Scope", v: "One vendor, one product, one partner, one campaign." },
  { k: "Targets", v: "Roughly 100 accounts, ranked and evidenced." },
  { k: "Duration", v: "30 days of activation support." },
  { k: "Output", v: "Approved motions, campaign assets, and the outcome data behind them." },
];

function Section({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-[1120px] px-6 py-[clamp(64px,9vw,120px)]">
      {children}
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="meridian relative min-h-screen overflow-x-hidden">
      <Beam />

      <div className="relative z-10">
        {/* ---- Chrome ------------------------------------------------- */}
        <header
          className="sticky top-0 z-20 backdrop-blur-sm"
          style={{
            borderBottom: "1px solid var(--pos-line-soft)",
            background: "rgba(4,13,67,0.72)",
          }}
        >
          <div className="mx-auto flex h-[54px] max-w-[1120px] items-center gap-8 px-6">
            <a href="#top" className="shrink-0">
              <Lockup size={15} />
            </a>
            <nav className="ml-auto flex items-center gap-7">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="pos-reaction hidden text-[13px] sm:block"
                  style={{ color: "var(--pos-fg-muted)" }}
                >
                  {item.label}
                </a>
              ))}
              <a
                href="#request"
                className="pos-reaction text-[13px] font-medium"
                style={{ color: "var(--pos-accent)" }}
              >
                Book a demo
              </a>
            </nav>
          </div>
        </header>

        {/* ---- Hero --------------------------------------------------- */}
        <div id="top" className="mx-auto max-w-[1120px] px-6 pb-[clamp(56px,8vw,96px)] pt-[clamp(72px,11vw,148px)]">
          <MicroLabel>Partner-led revenue</MicroLabel>
          <h1
            className="mt-6 max-w-[16ch] text-[clamp(40px,7.4vw,76px)] font-medium"
            style={{ letterSpacing: "-0.048em", lineHeight: 1.0 }}
          >
            Know where revenue moves next.
          </h1>
          <p
            className="mt-7 max-w-[50ch] text-[17px]"
            style={{ lineHeight: 1.62, color: "var(--pos-fg-muted)" }}
          >
            PursuitOS scores the intersection of customer, product, partner, seller and timing, then
            assembles the motion to pursue it.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <ButtonPrimary href="#request" large>
              Request access
            </ButtonPrimary>
            <ButtonSecondary href="#evidence" large>
              See the methodology
            </ButtonSecondary>
          </div>

          <div className="mt-[clamp(56px,7vw,88px)] grid grid-cols-2 gap-x-8 gap-y-9 md:grid-cols-4">
            {HERO_METRICS.map((m) => (
              <div key={m.label}>
                <div className="pos-num text-[clamp(26px,3vw,34px)]" style={{ lineHeight: 1 }}>
                  {m.value}
                </div>
                <div
                  className="mt-2.5 text-[13px]"
                  style={{ color: "var(--pos-fg-muted)", letterSpacing: "-0.01em" }}
                >
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- 01 · The activation gap -------------------------------- */}
        <Section id="platform">
          <div className="flex items-baseline gap-4">
            <MicroLabel>The problem</MicroLabel>
            <SectionNumber n="01" />
          </div>
          <SectionHeading className="mt-6 max-w-[20ch]">
            The channel does not have a recruitment problem.
          </SectionHeading>
          <Body className="mt-6 max-w-[62ch]">
            Vendors sign partners, allocate MDF, publish portal content and distribute generic
            account lists. Very little coordinated seller execution results. The gap is not who you
            have signed — it is knowing which combination to activate, and moving on it while the
            trigger is still open.
          </Body>

          <HairlineGrid className="mt-12 md:grid-cols-2">
            {CATEGORIES.map((c) => (
              <HairlineCell key={c.name} className="p-8">
                <div
                  className="text-[14px] font-medium"
                  style={{
                    letterSpacing: "-0.024em",
                    color: c.assertion ? "var(--pos-accent)" : "var(--pos-fg)",
                  }}
                >
                  {c.name}
                </div>
                <p
                  className="mt-3 text-[15px]"
                  style={{ lineHeight: 1.55, color: "var(--pos-fg-muted)" }}
                >
                  {c.line}
                </p>
              </HairlineCell>
            ))}
          </HairlineGrid>
        </Section>

        {/* ---- 02 · The system doing work ------------------------------ */}
        <Section id="evidence">
          <div className="flex items-baseline gap-4">
            <MicroLabel>The system doing work</MicroLabel>
            <SectionNumber n="02" />
          </div>
          <SectionHeading className="mt-6 max-w-[22ch]">
            This account is moving. Here is the evidence.
          </SectionHeading>
          <Lead className="mt-6 max-w-[54ch]">
            Every score opens into the features that produced it and the evidence behind them. No
            number in PursuitOS is unexplained.
          </Lead>

          <Panel className="mt-12 overflow-hidden">
            <div className="grid lg:grid-cols-[1.35fr_1fr]">
              {/* Pursuit detail */}
              <div className="p-[clamp(24px,3.2vw,34px)]">
                <MicroLabel>Pursuit · PUR-4417</MicroLabel>
                <h3
                  className="mt-3 text-[27px] font-medium"
                  style={{ letterSpacing: "-0.036em" }}
                >
                  Northwind Logistics
                </h3>
                <p className="mt-2 text-[14px]" style={{ color: "var(--pos-fg-muted)" }}>
                  Data platform modernisation · EMEA · via Ingram Micro
                </p>

                <div className="mt-8 flex gap-12">
                  <Metric label="Propensity" value="87.4" assertion />
                  <Metric label="Confidence" value="0.72" />
                </div>

                <div className="mt-9">
                  <MicroLabel>Why now</MicroLabel>
                  <div className="mt-3" style={{ borderTop: "1px solid var(--pos-line-soft)" }}>
                    {EVIDENCE.map((e) => (
                      <div key={e.label} style={{ borderBottom: "1px solid var(--pos-line-soft)" }}>
                        <EvidenceRow label={e.label} weight={e.weight} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Assembled team — sunken ground */}
              <div
                className="p-[clamp(24px,3.2vw,34px)]"
                style={{
                  background: "var(--pos-void)",
                  borderLeft: "1px solid var(--pos-line-soft)",
                }}
              >
                <MicroLabel>Assembled team</MicroLabel>
                <div className="mt-4 space-y-4">
                  {TEAM.map((t) => (
                    <div key={t.name} className="flex items-center gap-3">
                      <span
                        className="h-[26px] w-[26px] shrink-0"
                        style={{ background: "var(--pos-raised)", borderRadius: "2px" }}
                      />
                      <span>
                        <span className="block text-[13.5px]" style={{ letterSpacing: "-0.02em" }}>
                          {t.name}
                        </span>
                        <span
                          className="pos-num block text-[11px]"
                          style={{ color: "var(--pos-fg-muted)" }}
                        >
                          {t.role}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-9">
                  <MicroLabel>Next best action</MicroLabel>
                  <p
                    className="mt-3 text-[14px]"
                    style={{ lineHeight: 1.6, color: "var(--pos-fg-muted)" }}
                  >
                    Brief Ingram on the renewal window and request a joint intro to the VP Data
                    Platform before the Q3 close.
                  </p>
                </div>

                <div className="mt-8 flex flex-wrap gap-2.5">
                  <ButtonSecondary href="#request">Launch motion</ButtonSecondary>
                  <ButtonSecondary href="#request">Evidence</ButtonSecondary>
                </div>
              </div>
            </div>
          </Panel>
        </Section>

        {/* ---- 03 · Six engines --------------------------------------- */}
        <Section id="ecosystem">
          <div className="flex items-baseline gap-4">
            <MicroLabel>Six engines, one graph</MicroLabel>
            <SectionNumber n="03" />
          </div>
          <SectionHeading className="mt-6 max-w-[20ch]">
            Data to decision to outcome, then back again.
          </SectionHeading>
          <Body className="mt-6 max-w-[62ch]">
            The asset is not the dataset. It is the closed loop — who we predicted, why, through
            which partner, what the seller did, and what the customer actually bought — captured as
            immutable events and repeated at scale.
          </Body>

          <HairlineGrid className="mt-12 sm:grid-cols-2 lg:grid-cols-3">
            {ENGINES.map((e) => (
              <HairlineCell key={e.name} className="p-8">
                <SectionNumber n={e.n} />
                <div
                  className="mt-4 text-[14px] font-medium"
                  style={{ letterSpacing: "-0.024em" }}
                >
                  {e.name}
                </div>
                <p
                  className="mt-2.5 text-[15px]"
                  style={{ lineHeight: 1.55, color: "var(--pos-fg-muted)" }}
                >
                  {e.line}
                </p>
              </HairlineCell>
            ))}
          </HairlineGrid>
        </Section>

        {/* ---- 04 · How it starts ------------------------------------- */}
        <Section>
          <div className="flex items-baseline gap-4">
            <MicroLabel>How it starts</MicroLabel>
            <SectionNumber n="04" />
          </div>
          <SectionHeading className="mt-6 max-w-[20ch]">30-Day Partner Activation.</SectionHeading>
          <Lead className="mt-6 max-w-[54ch]">
            One motion, run end to end, with the evidence and the outcome data to show whether it
            worked.
          </Lead>

          <dl
            className="mt-12 max-w-[720px]"
            style={{ borderBottom: "1px solid var(--pos-line-soft)" }}
          >
            {ENGAGEMENT.map((row) => (
              <div
                key={row.k}
                className="grid grid-cols-[96px_1fr] gap-6 py-5 sm:grid-cols-[140px_1fr]"
                style={{ borderTop: "1px solid var(--pos-line-soft)" }}
              >
                <dt className="pos-micro pt-1">{row.k}</dt>
                <dd className="text-[15px]" style={{ lineHeight: 1.55 }}>
                  {row.v}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* ---- Close --------------------------------------------------- */}
        <Section id="request">
          <div
            className="flex flex-col items-start gap-8 py-[clamp(40px,5vw,64px)]"
            style={{ borderTop: "1px solid var(--pos-line-soft)" }}
          >
            <SectionHeading className="max-w-[18ch]">
              Know where revenue moves next.
            </SectionHeading>
            <Body className="max-w-[52ch]">
              We are taking a small number of design partners. One vendor, one partner, one
              campaign, thirty days.
            </Body>
            <div className="flex flex-wrap items-center gap-3">
              <ButtonPrimary href="mailto:hello@pursuitos.io" large>
                Request access
              </ButtonPrimary>
              <ButtonSecondary href="#evidence" large>
                See the methodology
              </ButtonSecondary>
            </div>
          </div>
        </Section>

        {/* ---- Footer -------------------------------------------------- */}
        <footer style={{ borderTop: "1px solid var(--pos-line-soft)" }}>
          <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-6 px-6 py-8">
            <Lockup size={15} />
            <span className="pos-micro">Meridian · Partner revenue graph</span>
            <span className="pos-micro ml-auto">© 2026 PursuitOS</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
