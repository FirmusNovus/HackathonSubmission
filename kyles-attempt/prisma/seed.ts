import { PrismaClient, Role, PricingKind, VerificationStatus, BookingStatus } from "@prisma/client";

const prisma = new PrismaClient();

type SeedLawyer = {
  walletAddress: string;
  name: string;
  email: string;
  city: string;
  headline: string;
  bio: string;
  specialty: string;
  tags: string[];
  specialties: string[];
  languages: string[];
  jurisdictions: string[];
  barJurisdiction: string;
  barRegistrationNum: string;
  yearsExperience: number;
  admissionDate: Date;
  pricingKind: PricingKind;
  pricingHeadline: string;
  hourlyRateEUR: number;
  consultationRate30: number;
  consultationRate60: number;
  pricingItems: Array<{ title: string; desc: string; price: number | null; unit: string }>;
  rating: number;
  reviewCount: number;
  verificationStatus: VerificationStatus;
};

// Twelve EU-spanning lawyers with a mix of pricing models.
const LAWYERS: SeedLawyer[] = [
  {
    walletAddress: "0x1111000000000000000000000000000000000001",
    name: "Maria Chen",
    email: "maria.chen@example.eu",
    city: "Stockholm",
    headline: "Family & Estate counsel · Stockholm",
    bio: "Twenty-two years guiding families through inheritance, divorce and custody under Swedish and EU law. I work in plain language, never billable hours.",
    specialty: "Family & Estate",
    tags: ["Family", "Estate"],
    specialties: ["Family Law", "Estate Planning", "EU Cross-Border"],
    languages: ["Swedish", "English"],
    jurisdictions: ["SE", "EU"],
    barJurisdiction: "Stockholm Bar Association",
    barRegistrationNum: "SE-2003-08291",
    yearsExperience: 22,
    admissionDate: new Date("2003-09-12"),
    pricingKind: PricingKind.HOURLY,
    pricingHeadline: "€240 / hr",
    hourlyRateEUR: 240,
    consultationRate30: 140,
    consultationRate60: 240,
    pricingItems: [],
    rating: 4.9,
    reviewCount: 184,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000002",
    name: "Klaus Hoffmann",
    email: "klaus.hoffmann@example.eu",
    city: "Berlin",
    headline: "Corporate & M&A · Berlin",
    bio: "Cross-border transactions for European mid-market companies. Founded a boutique practice in 2019 after a partnership at a major Frankfurt firm.",
    specialty: "Corporate & M&A",
    tags: ["Corporate", "M&A"],
    specialties: ["Corporate Law", "M&A", "Joint Ventures"],
    languages: ["German", "English"],
    jurisdictions: ["DE", "EU"],
    barJurisdiction: "Berlin Bar (Rechtsanwaltskammer)",
    barRegistrationNum: "DE-2010-44217",
    yearsExperience: 15,
    admissionDate: new Date("2010-04-19"),
    pricingKind: PricingKind.HOURLY,
    pricingHeadline: "€480 / hr",
    hourlyRateEUR: 480,
    consultationRate30: 280,
    consultationRate60: 480,
    pricingItems: [],
    rating: 4.8,
    reviewCount: 96,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000003",
    name: "Sofia Romano",
    email: "sofia.romano@example.eu",
    city: "Rome",
    headline: "Property & Real Estate · Rome",
    bio: "Residential and commercial property — purchases, leases, disputes. International buyers across Italy and the wider EU since 2008.",
    specialty: "Property",
    tags: ["Property", "Real Estate"],
    specialties: ["Property Law", "Commercial Leases", "Real Estate Disputes"],
    languages: ["Italian", "English", "French"],
    jurisdictions: ["IT", "EU"],
    barJurisdiction: "Ordine degli Avvocati di Roma",
    barRegistrationNum: "IT-2008-77012",
    yearsExperience: 17,
    admissionDate: new Date("2008-11-03"),
    pricingKind: PricingKind.HOURLY,
    pricingHeadline: "€220 / hr",
    hourlyRateEUR: 220,
    consultationRate30: 130,
    consultationRate60: 220,
    pricingItems: [],
    rating: 4.7,
    reviewCount: 73,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000004",
    name: "Lucas Dubois",
    email: "lucas.dubois@example.eu",
    city: "Paris",
    headline: "Immigration · Paris",
    bio: "EU residency, work permits, and family reunification across the Schengen area. I take complex cases that other firms turn away.",
    specialty: "Immigration",
    tags: ["Immigration", "EU Law"],
    specialties: ["Immigration Law", "Schengen Visas", "Family Reunification"],
    languages: ["French", "English", "Arabic"],
    jurisdictions: ["FR", "EU"],
    barJurisdiction: "Barreau de Paris",
    barRegistrationNum: "FR-2014-22198",
    yearsExperience: 11,
    admissionDate: new Date("2014-01-22"),
    pricingKind: PricingKind.FIXED,
    pricingHeadline: "from €450",
    hourlyRateEUR: 180,
    consultationRate30: 110,
    consultationRate60: 180,
    pricingItems: [
      { title: "Schengen visa application", desc: "Document review, application, follow-up", price: 450, unit: "fixed" },
      { title: "EU residency permit", desc: "Full filing + 1 follow-up consultation", price: 1200, unit: "fixed" },
      { title: "Family reunification", desc: "End-to-end with translations included", price: 2400, unit: "fixed" },
    ],
    rating: 5.0,
    reviewCount: 211,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000005",
    name: "Anya Kowalski",
    email: "anya.kowalski@example.eu",
    city: "Warsaw",
    headline: "Employment · Warsaw",
    bio: "Employee-side employment law — wrongful dismissal, discrimination, executive contracts. I represent the person across the table from HR.",
    specialty: "Employment",
    tags: ["Employment", "Labor"],
    specialties: ["Employment Law", "Discrimination", "Executive Contracts"],
    languages: ["Polish", "English", "German"],
    jurisdictions: ["PL", "EU"],
    barJurisdiction: "Polish Bar Council",
    barRegistrationNum: "PL-2012-13987",
    yearsExperience: 13,
    admissionDate: new Date("2012-06-08"),
    pricingKind: PricingKind.SUCCESS,
    pricingHeadline: "No win, no fee",
    hourlyRateEUR: 200,
    consultationRate30: 0,
    consultationRate60: 0,
    pricingItems: [
      { title: "Wrongful dismissal", desc: "Contingent fee · 22% of award", price: null, unit: "22% of award" },
      { title: "Initial case assessment", desc: "Free 30-min review of your situation", price: 0, unit: "free" },
    ],
    rating: 4.9,
    reviewCount: 142,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000006",
    name: "Henrik Andersson",
    email: "henrik.andersson@example.eu",
    city: "Copenhagen",
    headline: "IP & Trademark · Copenhagen",
    bio: "Trademarks, copyright, and brand protection across the EU. I price every deliverable up front so you know what you're paying for.",
    specialty: "IP & Trademark",
    tags: ["IP", "Trademark"],
    specialties: ["Trademark Law", "Copyright", "Brand Protection"],
    languages: ["Danish", "English", "German"],
    jurisdictions: ["DK", "EU"],
    barJurisdiction: "Danish Bar and Law Society",
    barRegistrationNum: "DK-2009-50128",
    yearsExperience: 16,
    admissionDate: new Date("2009-03-15"),
    pricingKind: PricingKind.FIXED,
    pricingHeadline: "from €390",
    hourlyRateEUR: 320,
    consultationRate30: 200,
    consultationRate60: 320,
    pricingItems: [
      { title: "EU trademark filing", desc: "Search, classification, EUIPO submission", price: 390, unit: "fixed" },
      { title: "Trademark + 1 jurisdiction", desc: "EU + your choice of national filing", price: 690, unit: "fixed" },
      { title: "Cease & desist letter", desc: "Drafted and dispatched", price: 240, unit: "fixed" },
      { title: "Opposition response", desc: "Full response brief and filing", price: 1450, unit: "fixed" },
    ],
    rating: 4.9,
    reviewCount: 67,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000007",
    name: "Isabella Marchetti",
    email: "isabella.marchetti@example.eu",
    city: "Milan",
    headline: "Business Formation · Milan",
    bio: "Helping founders set up Italian and EU entities. Practical, founder-friendly counsel — not a six-month engagement letter.",
    specialty: "Business Formation",
    tags: ["Business", "Tax"],
    specialties: ["Business Formation", "Tax", "Founder Counsel"],
    languages: ["Italian", "English", "Spanish"],
    jurisdictions: ["IT", "EU"],
    barJurisdiction: "Ordine degli Avvocati di Milano",
    barRegistrationNum: "IT-2015-39811",
    yearsExperience: 10,
    admissionDate: new Date("2015-09-30"),
    pricingKind: PricingKind.SUBSCRIPTION,
    pricingHeadline: "€480 / mo",
    hourlyRateEUR: 280,
    consultationRate30: 160,
    consultationRate60: 280,
    pricingItems: [
      { title: "Founder retainer", desc: "4 hours/mo · contracts, hiring, advice", price: 480, unit: "/ month" },
      { title: "Growth retainer", desc: "12 hours/mo · ongoing counsel", price: 1200, unit: "/ month" },
      { title: "Italian S.r.l. setup", desc: "Entity formation + tax registration", price: 1800, unit: "fixed" },
    ],
    rating: 4.8,
    reviewCount: 88,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000008",
    name: "Thomas Bauer",
    email: "thomas.bauer@example.eu",
    city: "Vienna",
    headline: "Corporate Counsel · Vienna",
    bio: "General counsel and commercial contracts for Austrian and German SMEs. Direct, decisive advice with rapid turnaround.",
    specialty: "Corporate",
    tags: ["Corporate", "Contracts"],
    specialties: ["Corporate Law", "Commercial Contracts", "Compliance"],
    languages: ["German", "English"],
    jurisdictions: ["AT", "DE", "EU"],
    barJurisdiction: "Austrian Bar Association",
    barRegistrationNum: "AT-2011-09322",
    yearsExperience: 14,
    admissionDate: new Date("2011-05-04"),
    pricingKind: PricingKind.HOURLY,
    pricingHeadline: "€360 / hr",
    hourlyRateEUR: 360,
    consultationRate30: 210,
    consultationRate60: 360,
    pricingItems: [],
    rating: 4.7,
    reviewCount: 58,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000009",
    name: "Elena Vasquez",
    email: "elena.vasquez@example.eu",
    city: "Madrid",
    headline: "Immigration · Madrid",
    bio: "Spanish residency, golden visa, and EU mobility. Bilingual practice serving Latin American and EU clients.",
    specialty: "Immigration",
    tags: ["Immigration", "Residency"],
    specialties: ["Immigration Law", "Golden Visa", "EU Mobility"],
    languages: ["Spanish", "English", "Portuguese"],
    jurisdictions: ["ES", "EU"],
    barJurisdiction: "Ilustre Colegio de Abogados de Madrid",
    barRegistrationNum: "ES-2013-66104",
    yearsExperience: 12,
    admissionDate: new Date("2013-02-14"),
    pricingKind: PricingKind.FIXED,
    pricingHeadline: "from €600",
    hourlyRateEUR: 220,
    consultationRate30: 130,
    consultationRate60: 220,
    pricingItems: [
      { title: "Spanish residency application", desc: "Full filing, in-person appointments", price: 600, unit: "fixed" },
      { title: "Golden visa", desc: "Investment-based residency, end-to-end", price: 3500, unit: "fixed" },
      { title: "Citizenship application", desc: "Naturalization filing & oath prep", price: 1800, unit: "fixed" },
    ],
    rating: 4.9,
    reviewCount: 124,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000010",
    name: "Pieter de Vries",
    email: "pieter.devries@example.eu",
    city: "Amsterdam",
    headline: "Privacy & Data · Amsterdam",
    bio: "GDPR and EU data law for SaaS and adtech. Fractional DPO arrangements, audits, and incident response on a fixed monthly fee.",
    specialty: "Privacy & Data",
    tags: ["GDPR", "Compliance"],
    specialties: ["GDPR", "Data Protection", "Privacy Compliance"],
    languages: ["Dutch", "English", "French"],
    jurisdictions: ["NL", "EU"],
    barJurisdiction: "Netherlands Bar (NOvA)",
    barRegistrationNum: "NL-2016-71845",
    yearsExperience: 9,
    admissionDate: new Date("2016-08-22"),
    pricingKind: PricingKind.SUBSCRIPTION,
    pricingHeadline: "€890 / mo",
    hourlyRateEUR: 300,
    consultationRate30: 180,
    consultationRate60: 300,
    pricingItems: [
      { title: "Fractional DPO", desc: "Outsourced data protection officer", price: 890, unit: "/ month" },
      { title: "GDPR audit", desc: "Full compliance review and gap analysis", price: 2400, unit: "fixed" },
      { title: "DPIA", desc: "Data protection impact assessment", price: 1100, unit: "fixed" },
    ],
    rating: 4.8,
    reviewCount: 54,
    verificationStatus: VerificationStatus.VERIFIED,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000011",
    name: "Margaux Laurent",
    email: "margaux.laurent@example.eu",
    city: "Brussels",
    headline: "EU Regulatory · Brussels",
    bio: "EU competition, state aid, and regulatory work. Former Commission staff; now advising firms navigating Brussels.",
    specialty: "EU Regulatory",
    tags: ["EU Law", "Regulatory"],
    specialties: ["Competition Law", "State Aid", "EU Regulation"],
    languages: ["French", "English", "Dutch"],
    jurisdictions: ["BE", "EU"],
    barJurisdiction: "Brussels Bar (Ordre français)",
    barRegistrationNum: "BE-2009-31728",
    yearsExperience: 16,
    admissionDate: new Date("2009-10-11"),
    pricingKind: PricingKind.HOURLY,
    pricingHeadline: "€420 / hr",
    hourlyRateEUR: 420,
    consultationRate30: 240,
    consultationRate60: 420,
    pricingItems: [],
    rating: 4.9,
    reviewCount: 79,
    verificationStatus: VerificationStatus.PENDING,
  },
  {
    walletAddress: "0x1111000000000000000000000000000000000012",
    name: "Stefan Novak",
    email: "stefan.novak@example.eu",
    city: "Prague",
    headline: "Tax & Cross-Border · Prague",
    bio: "Personal and corporate tax across CEE. Fluent in cross-border structures and the practical reality of EU tax compliance.",
    specialty: "Tax",
    tags: ["Tax", "Cross-Border"],
    specialties: ["Tax Law", "Corporate Tax", "Cross-Border Structuring"],
    languages: ["Czech", "English", "German"],
    jurisdictions: ["CZ", "EU"],
    barJurisdiction: "Czech Bar Association",
    barRegistrationNum: "CZ-2014-92011",
    yearsExperience: 11,
    admissionDate: new Date("2014-07-18"),
    pricingKind: PricingKind.HOURLY,
    pricingHeadline: "€260 / hr",
    hourlyRateEUR: 260,
    consultationRate30: 150,
    consultationRate60: 260,
    pricingItems: [],
    rating: 4.7,
    reviewCount: 41,
    verificationStatus: VerificationStatus.PENDING,
  },
];

async function main() {
  console.log("[seed] Resetting bookings, conversations, messages, lawyer profiles, users …");
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.lawyerProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.nonce.deleteMany();

  console.log("[seed] Creating 12 lawyers …");
  for (const l of LAWYERS) {
    await prisma.user.create({
      data: {
        walletAddress: l.walletAddress.toLowerCase(),
        role: Role.LAWYER,
        name: l.name,
        email: l.email,
        ebsiWalletProvider: "ds",
        lawyerProfile: {
          create: {
            city: l.city,
            headline: l.headline,
            bio: l.bio,
            specialties: l.specialties,
            languages: l.languages,
            jurisdictions: l.jurisdictions,
            tags: l.tags,
            pricingKind: l.pricingKind,
            pricingHeadline: l.pricingHeadline,
            hourlyRateEUR: l.hourlyRateEUR,
            consultationRate30: l.consultationRate30,
            consultationRate60: l.consultationRate60,
            pricingItems: l.pricingItems,
            yearsExperience: l.yearsExperience,
            verificationStatus: l.verificationStatus,
            barRegistrationNum: l.barRegistrationNum,
            barJurisdiction: l.barJurisdiction,
            admissionDate: l.admissionDate,
            credentialDocsUrl: [],
            rating: l.rating,
            reviewCount: l.reviewCount,
          },
        },
      },
    });
  }

  console.log("[seed] Creating sample clients …");
  const clients = await Promise.all(
    [
      { wallet: "0x2222000000000000000000000000000000000001", name: "Sarah Mueller", email: "sarah.mueller@example.eu" },
      { wallet: "0x2222000000000000000000000000000000000002", name: "James O'Connor", email: "james.oconnor@example.eu" },
      { wallet: "0x2222000000000000000000000000000000000003", name: "Léa Bernard", email: "lea.bernard@example.eu" },
      { wallet: "0x2222000000000000000000000000000000000004", name: "David Cohen", email: "david.cohen@example.eu" },
    ].map((c) =>
      prisma.user.create({
        data: {
          walletAddress: c.wallet.toLowerCase(),
          role: Role.CLIENT,
          name: c.name,
          email: c.email,
          ebsiWalletProvider: "ekibis",
          ageVerifiedAt: new Date(),
        },
      }),
    ),
  );

  console.log("[seed] Creating sample bookings + conversations …");
  const lawyers = await prisma.lawyerProfile.findMany({
    where: { verificationStatus: VerificationStatus.VERIFIED },
    orderBy: { createdAt: "asc" },
  });

  const sampleBookings: Array<{
    clientIdx: number;
    lawyerIdx: number;
    scheduledAt: Date;
    durationMinutes: number;
    fee: number;
    status: BookingStatus;
    practiceArea: string;
    description: string;
    messages: Array<{ from: "client" | "lawyer"; content: string }>;
  }> = [
    {
      clientIdx: 0,
      lawyerIdx: 0,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2),
      durationMinutes: 60,
      fee: 240,
      status: BookingStatus.ACCEPTED,
      practiceArea: "Family",
      description: "Cross-border inheritance — my father owned property in Sweden and Germany. Three siblings, trying to avoid court.",
      messages: [
        { from: "client", content: "Thank you for accepting. I've attached my father's 2008 will in the next message." },
        { from: "lawyer", content: "Received. We'll go through the EU succession regulation in our session — it'll likely apply here." },
        { from: "client", content: "Sounds good. Talk Thursday." },
      ],
    },
    {
      clientIdx: 1,
      lawyerIdx: 3,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
      durationMinutes: 60,
      fee: 1200,
      status: BookingStatus.ACCEPTED,
      practiceArea: "Immigration",
      description: "EU residency permit application. UK national, post-Brexit, looking to relocate to Paris with family.",
      messages: [
        { from: "lawyer", content: "Confirmed for Friday. Please prepare your last 3 months of payslips and a residence proof." },
        { from: "client", content: "Will do. Thank you." },
      ],
    },
    {
      clientIdx: 2,
      lawyerIdx: 6,
      scheduledAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
      durationMinutes: 60,
      fee: 480,
      status: BookingStatus.COMPLETED,
      practiceArea: "Business",
      description: "Italian S.r.l. setup for a SaaS company. Need help with NIF, founder agreements, IP assignment.",
      messages: [
        { from: "lawyer", content: "Great session today. I'll send the founder agreement draft within 48 hours." },
        { from: "client", content: "Perfect — and thank you for the practical advice on stock options." },
      ],
    },
    {
      clientIdx: 3,
      lawyerIdx: 4,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 1),
      durationMinutes: 30,
      fee: 0,
      status: BookingStatus.REQUESTED,
      practiceArea: "Employment",
      description: "Wrongful dismissal — terminated last week without notice or cause. Two years tenure, mid-level role.",
      messages: [],
    },
  ];

  for (const sb of sampleBookings) {
    const ratePerHour = sb.fee > 0 ? Math.round((sb.fee * 60) / sb.durationMinutes) : 0;
    const lineItems =
      sb.fee > 0
        ? [
            {
              id: "li-1",
              title: `${sb.durationMinutes}-minute consultation`,
              kind: "hourly" as const,
              hours: sb.durationMinutes / 60,
              ratePerHour,
              subtotal: sb.fee,
            },
          ]
        : [
            {
              id: "li-1",
              title: "Free initial assessment",
              kind: "fixed" as const,
              fixedPrice: 0,
              subtotal: 0,
            },
          ];
    const deliverables = [
      { id: "d-1", title: "Live consultation", description: `${sb.durationMinutes}-minute video meeting` },
      { id: "d-2", title: "Verbal advice on the case as discussed" },
    ];
    const isFinal = sb.status !== BookingStatus.REQUESTED;
    const booking = await prisma.booking.create({
      data: {
        clientId: clients[sb.clientIdx].id,
        lawyerProfileId: lawyers[sb.lawyerIdx].id,
        scheduledAt: sb.scheduledAt,
        durationMinutes: sb.durationMinutes,
        lineItems,
        deliverables,
        // Client always signs at booking time. Lawyer signs only if the
        // booking has progressed past REQUESTED.
        clientAcceptedAt: new Date(),
        lawyerAcceptedAt: isFinal ? new Date() : null,
        consultationFeeEUR: sb.fee,
        platformFeeEUR: sb.fee * 0.05,
        status: sb.status,
        practiceArea: sb.practiceArea,
        caseDescription: sb.description,
        escrowTxHash: isFinal ? `0x${"abcd".repeat(16)}`.slice(0, 66) : null,
      },
    });

    if (sb.messages.length > 0) {
      const lawyerUser = await prisma.user.findFirst({ where: { lawyerProfile: { id: lawyers[sb.lawyerIdx].id } } });
      if (!lawyerUser) continue;
      const conversation = await prisma.conversation.create({
        data: {
          bookingId: booking.id,
          participants: { connect: [{ id: clients[sb.clientIdx].id }, { id: lawyerUser.id }] },
        },
      });
      for (const m of sb.messages) {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: m.from === "client" ? clients[sb.clientIdx].id : lawyerUser.id,
            content: m.content,
          },
        });
      }
    }
  }

  console.log("[seed] Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
