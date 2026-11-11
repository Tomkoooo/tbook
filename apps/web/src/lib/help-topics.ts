import type { Permission } from "@tbook/schemas";

/**
 * The console's user guide (Súgó). Each topic says which module and which
 * permissions it is about, so the help page shows a member only what their
 * organization has switched on and what they may do. Written for
 * organizers, in Hungarian, like the guest-facing pages.
 */
export interface HelpSection {
  heading: string;
  /** Numbered steps. */
  steps?: string[];
  /** Plain paragraphs. */
  text?: string[];
}

export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  /** Shown only when the organization has this module. */
  module?: string;
  /** Shown only to members with at least one of these (fallbacks apply). */
  permissions?: Permission[];
  /** Where in the console it happens. */
  links?: Array<{ href: string; label: string }>;
  sections: HelpSection[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "attekintes",
    title: "Első lépések",
    summary: "Hogyan épül fel a tBook konzol, és mi hol található.",
    sections: [
      {
        heading: "A konzol felépítése",
        text: [
          "A bal oldali menüben csak az jelenik meg, amihez jogosultságod van, és amit a szervezeted számára bekapcsoltak. Ha valamit nem találsz, kérd a szervezet tulajdonosát, hogy adjon hozzá jogosultságot (Csapat → szerepkörök).",
          "A plusz funkciók (ingyenes regisztráció, buszok, e-mailek, várólista, vendég önkiszolgálás, visszajelzés) modulok. A rendszergazda engedélyezi őket a szervezetnek, utána eseményenként vagy eseménycsoportonként kapcsolhatók be az esemény oldalán, a „Modules” részben.",
        ],
      },
      {
        heading: "Ajánlott sorrend egy új eseménynél",
        steps: [
          "Ha a regisztrációt listához kell kötni (pl. dolgozói törzsszám), töltsd fel az Excelt az Adatok menüben.",
          "Hozd létre az eseményt (Events → New event), add meg a dátumot, a helyszínt és a létszámkorlátot.",
          "Állítsd össze a regisztrációs űrlapot és a szabályokat (lásd „Regisztrációs űrlap”).",
          "Kapcsold be a szükséges modulokat az esemény Modules részében.",
          "Az Előnézet oldalon próbáld ki az űrlapot, a buszkapitány és a beléptető nézetét.",
          "Állítsd az eseményt aktívra, és add meg a weboldalnak az eseménycsoport API kulcsát.",
        ],
      },
    ],
  },
  {
    id: "urlap",
    title: "Regisztrációs űrlap és szabályok",
    summary: "Kérdések összeállítása, feltételes kérdések, egyediség, azonosító alapú kitöltés, jogosultsági szabályok.",
    permissions: ["event:write"],
    links: [
      { href: "/admin/events", label: "Események" },
      { href: "/admin/preview", label: "Előnézet" },
    ],
    sections: [
      {
        heading: "Kérdések hozzáadása",
        steps: [
          "Nyisd meg az eseményt, és menj a regisztrációs kérdésekhez.",
          "„Add question”: add meg a kérdést és a típusát (rövid vagy hosszú szöveg, e-mail, telefon, szám, dátum, legördülő lista, jelölőnégyzet).",
          "Legördülő listánál soronként egy válasz. A „kód | felirat” formával a tárolt érték eltérhet a megjelenítettől.",
          "A „Required” kötelezővé teszi a kérdést. Jelölőnégyzetnél (pl. adatkezelési hozzájárulás) azt jelenti, hogy be kell pipálni.",
          "Az „Ask only when” beállítással a kérdés csak akkor jelenik meg, ha egy másik kérdésre adott válasz egyezik (pl. a buszjárat csak akkor, ha kér transzfert).",
        ],
      },
      {
        heading: "Egyediség és azonosító",
        text: [
          "„Unique per event”: egy válasz (pl. törzsszám) csak egyszer szerepelhet aktív regisztrációban. Ha valaki ugyanazzal újra próbálkozik, a rendszer elutasítja.",
          "„Identifies the guest”: ezzel a válasszal lehet egy vendéget megtalálni (vendég önkiszolgálás, visszajelzés, címkék importja).",
        ],
      },
      {
        heading: "Első lépés: azonosító megadása, automatikus kitöltés",
        text: [
          "Az űrlap kezdődhet az azonosítóval (pl. törzsszám). A vendég beírja, a rendszer megkeresi az adatlistában, és kitölti a többi mezőt (név, munkáltató, e-mail). Ezeket a vendég ezután szabadon módosíthatja.",
        ],
        steps: [
          "Töltsd fel a listát az Adatok menüben. A kulcsoszlop az azonosító legyen.",
          "Az azonosító kérdésnél kapcsold be az „Identifies the guest” beállítást.",
          "A szabályoknál adj hozzá egy „is in list” szabályt erre a kérdésre, a feltöltött listával.",
          "A többi kérdésnél a „Prefill from data list column” mezőben válaszd ki, melyik oszlopból töltődjön. Legördülő listánál a cella értéke a kóddal vagy a felirattal egyezzen.",
          "Az Előnézet → Regisztrációs űrlap fülön próbáld ki egy valódi azonosítóval.",
        ],
      },
      {
        heading: "Jogosultsági szabályok",
        text: [
          "A szabályok a válaszokat ellenőrzik: egyezés, formátum (regex), lista, szám- és korhatár, illetve ezek ÉS/VAGY kombinációi. Az „is in list” egy feltöltött adatlistában keresi a választ, így több ezer azonosítóval is működik.",
          "Minden szabályhoz saját hibaüzenet adható. A vendég ezt látja, ha nem felel meg.",
        ],
      },
    ],
  },
  {
    id: "adatok",
    title: "Adatlisták és Excel import",
    summary: "Dolgozói vagy vendéglisták feltöltése, buszjáratok és címkék importja táblázatból.",
    permissions: ["list:manage"],
    links: [{ href: "/admin/data", label: "Adatok" }],
    sections: [
      {
        heading: "Lista feltöltése",
        steps: [
          "Adatok → Import: töltsd fel az .xlsx vagy .csv fájlt, és válaszd ki a munkalapot.",
          "Válaszd a „Data list” célt, adj nevet a listának, és jelöld ki a kulcsoszlopot (pl. törzsszám).",
          "Egyeztetési mód: kis- és nagybetű nélkül, csak számjegyek, vagy csak betűk és számok. Törzsszámnál a „csak számjegyek” a biztos választás.",
          "Ha van név és e-mail oszlop, jelöld ki őket is.",
          "Frissítéskor ugyanazt a listát töltsd fel újra („replace”). A szabályok továbbra is erre mutatnak.",
        ],
      },
      {
        heading: "Más importok",
        text: [
          "Ugyanitt tölthetők fel a buszjáratok (busz modul) és a vendégcímkék (pl. VIP). A címke akkor is megmarad, ha a vendég csak később regisztrál.",
          "A lista a szervezeten belül marad. A vendég csak azt látja belőle, amit az űrlap kitöltéshez beállítottál.",
        ],
      },
    ],
  },
  {
    id: "ingyenes-regisztracio",
    title: "Ingyenes regisztráció",
    summary: "Fizetés nélküli jelentkezés létszámkorláttal és határidővel.",
    module: "free-registration",
    permissions: ["event:write"],
    sections: [
      {
        heading: "Beállítás",
        steps: [
          "Az esemény Modules részében kapcsold be a „Free registration” modult.",
          "Az esemény jegyára legyen 0. A létszámkorlát és a jelentkezési időszak (nyitás, zárás) az eseménynél állítható.",
          "Amikor a létszám betelik, a weboldal a várólistát kínálja fel, ha az be van kapcsolva.",
        ],
      },
    ],
  },
  {
    id: "regisztraciok",
    title: "Regisztrációk kezelése",
    summary: "Keresés, adatmódosítás, egy vendég lemondása, címkék, változásnapló, export.",
    permissions: ["booking:read"],
    links: [{ href: "/admin/bookings", label: "Foglalások" }],
    sections: [
      {
        heading: "Mindennapi teendők",
        steps: [
          "Foglalások: keress névre, e-mailre vagy regisztrációs számra, majd nyisd meg a foglalást.",
          "Adatok módosítása: a foglalás oldalán szerkeszd a vendég válaszait. A rendszer ugyanúgy ellenőrzi őket, mint regisztrációkor, és naplózza a változást.",
          "Egy vendég lemondása csoportos regisztrációból: a vendég sorában „Cancel guest”. A többiek regisztrációja megmarad, a lemondott vendég külön listában látszik.",
          "Címkék (pl. VIP, sajtó): a vendég sorában adhatók meg. Beléptetéskor megjelennek.",
          "A „Change history” rész mutatja, ki és mikor mit módosított.",
        ],
      },
      {
        heading: "Export és riport",
        text: [
          "A Riportok oldalon láthatók a fő számok, a válaszok szerinti bontások és a napi regisztrációk. Excelbe exportálhatók, a lemondott vendégek külön munkalapra kerülnek.",
        ],
      },
    ],
  },
  {
    id: "belepteto",
    title: "Beléptetés",
    summary: "QR-kód olvasása, keresés, dupla belépés kezelése, visszavonás.",
    permissions: ["voucher:read", "voucher:scan"],
    links: [{ href: "/admin/check-in", label: "Beléptetés" }],
    sections: [
      {
        heading: "Beléptetés az ajtónál",
        steps: [
          "Beléptetés → válaszd ki az eseményt.",
          "Olvasd be a QR-kódot kamerával vagy kézi olvasóval, vagy írd be a regisztrációs számot és nyomj Entert.",
          "Zöld: beléphet. Sárga „Already checked in”: ezzel a kóddal már beléptek, a rendszer mutatja, mikor. Piros: érvénytelen vagy más eseményhez tartozik.",
          "Ha valakinél nincs kód, a lenti névsorban keresd meg név vagy regisztrációs szám alapján, és léptesd be egy koppintással.",
          "A címke szűrővel csak például a VIP vendégek listázhatók.",
        ],
      },
      {
        heading: "Hibás beléptetés javítása",
        text: ["Az „Undo” gomb a névsorban csak „voucher:manage” jogosultsággal érhető el. Minden visszavonás naplózva van."],
      },
      {
        heading: "Beléptető munkatárs felvétele",
        text: ["Csapat → szerepkörök → New role → sablon: „Beléptető”. Utána hívd meg a munkatársat ezzel a szerepkörrel."],
      },
    ],
  },
  {
    id: "buszok",
    title: "Buszok és buszkapitányok",
    summary: "Járatok, helyfoglalás regisztrációkor, kapitányok, felszállás jelölése oda és vissza.",
    module: "bus-transport",
    permissions: ["bus:manage", "bus:board"],
    links: [{ href: "/admin/bus", label: "Buszok" }],
    sections: [
      {
        heading: "Járatok felvétele",
        steps: [
          "Buszok → „New bus”: add meg a kódot (pl. B03), a várost, a felszállás helyét és idejét, a férőhelyet és a kapitányt.",
          "Sok járatnál használd az importot: Adatok → Import → „Bus routes”. A sorokat a kód alapján egyezteti, így újrafeltöltéskor frissít.",
          "Az űrlapon a buszjárat kérdés legördülő listáját állítsd a „bus-transport:routes” forrásra. A betelt járatok „(full)” jelöléssel jelennek meg, és nem választhatók.",
          "A modul beállításaiban adható meg a transzferszabály szövege (pl. 15 perc várakozás). Ez e-mailben és a vendég önkiszolgálásban is megjelenik.",
        ],
      },
      {
        heading: "Kapitány kétféleképpen",
        text: [
          "Link: a járat sorának menüjében a „Create captain link” egy bejelentkezés nélküli linket ad, amely csak azt az egy buszt mutatja. „New captain link” esetén a régi megszűnik, a „Revoke captain link” letiltja.",
          "Szerepkör: Csapat → szerepkörök → sablon: „Buszkapitány” (bus:board). A meghívott kapitány bejelentkezve látja a buszokat, és jelölheti a felszállást, de járatot nem szerkeszthet.",
        ],
      },
      {
        heading: "Felszállás jelölése (kapitányoknak)",
        steps: [
          "Nyisd meg a buszodat (linkről vagy a Buszok menüből).",
          "Válts az „Odaút” vagy „Visszaút” fülre.",
          "Koppints a „Felszállt” vagy „Nem szállt fel” gombra. Ha újra megnyomod, törlődik a jelölés.",
          "A lista magától frissül. A keresővel név vagy azonosító alapján szűrhetsz.",
        ],
      },
    ],
  },
  {
    id: "emailek",
    title: "E-mailek",
    summary: "Automatikus visszaigazolás, kampányok, feltételek, helyettesítők.",
    module: "event-emails",
    permissions: ["email:send"],
    links: [{ href: "/admin/emails", label: "E-mailek" }],
    sections: [
      {
        heading: "Automatikus és kézi e-mailek",
        text: [
          "Az automatikus e-mail regisztrációkor megy ki, vendégenként, a vendég saját adataival (pl. visszaigazolás QR-kóddal). Ha a vendég módosítja az adatait, csak ő kapja meg újra.",
          "A kézi e-mail (pl. emlékeztető) akkor megy ki, amikor megnyomod a Send gombot. Időzítés nincs, ezért a megfelelő napon küldd ki.",
        ],
      },
      {
        heading: "Személyre szabás",
        steps: [
          "A szövegben helyettesítők használhatók, pl. {{firstName}}, {{bus.code}}, {{bus.rules}}, {{feedbackUrl}}. A szerkesztő listázza az elérhetőket.",
          "A feltételekkel szűkítheted a címzetteket (pl. csak akik buszt kértek).",
          "Küldés előtt nézd meg az előnézetet és a címzettek számát.",
        ],
      },
    ],
  },
  {
    id: "varolista",
    title: "Várólista",
    summary: "Betelt eseménynél a felszabaduló hely a sorban következőé.",
    module: "waitlist",
    permissions: ["waitlist:manage"],
    links: [{ href: "/admin/waitlist", label: "Várólista" }],
    sections: [
      {
        heading: "Működés",
        text: [
          "Ha az esemény betelt, a weboldal felajánlja a várólistát. A vendég ugyanazt az űrlapot tölti ki.",
          "Ha hely szabadul fel, a sorban első kapja meg: automatikus módban rögtön regisztrálja a rendszer, ajánlatos módban e-mailt kap, és a hely adott ideig (alapból 48 óra) neki van fenntartva.",
          "A Várólista oldalon látod a sorrendet, és törölhetsz bejegyzést.",
        ],
      },
    ],
  },
  {
    id: "vendeg",
    title: "Vendég önkiszolgálás",
    summary: "A vendég a weboldalon megnézi, módosítja vagy lemondja a regisztrációját.",
    module: "guest-portal",
    permissions: ["event:read"],
    sections: [
      {
        heading: "Mit tud a vendég",
        text: [
          "A weboldalon a regisztrációs számával vagy az azonosítójával (pl. törzsszám) belép. Látja az adatait (az e-mail és a telefonszám részben kitakarva), a buszát és a kapitány elérhetőségét, valamint a transzferszabályt.",
          "Módosíthatja a válaszait. Az azonosító és a zárolt kérdések nem módosíthatók, és az esemény kezdete után semmi sem. Ingyenes regisztrációt le is mondhat. Módosítás után újra megkapja a visszaigazolást.",
          "Hogy a vendég mit lát, azt az Előnézet → Vendég nézet fülön ellenőrizheted.",
        ],
      },
    ],
  },
  {
    id: "visszajelzes",
    title: "Visszajelzés és kioszk",
    summary: "Elégedettségi kérdőív személyes linkkel, és anonim értékelés tableten.",
    module: "feedback",
    permissions: ["feedback:manage", "feedback:kiosk"],
    links: [
      { href: "/admin/feedback", label: "Visszajelzés" },
      { href: "/admin/kiosk", label: "Kioszk" },
    ],
    sections: [
      {
        heading: "Kérdőív",
        steps: [
          "Visszajelzés → New survey → típus: „Survey”. Kérdéstípusok: értékelés 1–5, választás, szöveg.",
          "Küldd ki e-mailben a {{feedbackUrl}} helyettesítővel. Mindenki saját linket kap, és csak egyszer válaszolhat.",
          "A weboldalon a vendég a regisztrációs számával vagy az azonosítójával is kitöltheti.",
          "A válaszok név nélkül tárolódnak. Az eredmények és az Excel export a kérdőív oldalán érhetők el.",
        ],
      },
      {
        heading: "Kioszk (tablet a helyszínen)",
        text: [
          "Hozz létre „Kiosk” típusú kérdőívet (pl. jósda, kaszinó, catering).",
          "Indítás linkkel: a kioszk oldalán „Kiosk link”. Nyisd meg a tableten, bejelentkezés nem kell.",
          "Indítás szerepkörrel: Csapat → szerepkörök → sablon: „Kioszk” (feedback:kiosk). A munkatárs bejelentkezik a tableten, és a Kioszk menüben elindítja.",
          "Minden válasz után a képernyő pár másodperc múlva alaphelyzetbe áll.",
        ],
      },
    ],
  },
  {
    id: "csapat",
    title: "Csapat és jogosultságok",
    summary: "Munkatársak meghívása, szerepkörök sablonból (beléptető, buszkapitány, kioszk, szervező).",
    permissions: ["member:read"],
    links: [{ href: "/admin/members", label: "Csapat" }],
    sections: [
      {
        heading: "Szerepkör létrehozása",
        steps: [
          "Csapat → „New role”.",
          "„Start from a template”: Beléptető, Buszkapitány, Kioszk vagy Szervező. Ez kitölti a nevet és a jogosultságokat.",
          "Szükség esetén módosítsd a pipákat, majd mentsd.",
          "Hívd meg a munkatársat e-mail címmel, és válaszd ki a szerepkört. Egy tagnak több szerepköre is lehet.",
        ],
      },
      {
        heading: "Fontosabb jogosultságok",
        text: [
          "voucher:scan – beléptetés. voucher:manage – beléptetés visszavonása, jegy újraküldése.",
          "bus:board – buszkapitány: buszok megtekintése, felszállás jelölése. bus:manage – járatok és kapitánylinkek kezelése.",
          "feedback:kiosk – kioszk indítása bejelentkezve. feedback:manage – kérdőívek és eredmények.",
          "booking:manage – regisztrációk módosítása, lemondása. email:send – e-mailek küldése. list:manage – Excel importok.",
        ],
      },
    ],
  },
  {
    id: "elonezet",
    title: "Előnézet",
    summary: "Próbáld ki, mit lát a vendég, a buszkapitány, a beléptető és a kioszk, mentés nélkül.",
    permissions: ["event:read"],
    links: [{ href: "/admin/preview", label: "Előnézet" }],
    sections: [
      {
        heading: "Mire jó",
        text: [
          "Regisztrációs űrlap: ugyanazokkal a kérdésekkel, feltételekkel és élő buszhelyekkel működik, mint a weboldalon az API-n keresztül. Az azonosító megadása után kitölti az adatokat. A „Check” gomb lefuttatja az összes ellenőrzést (kötelező mezők, szabályok, egyediség), de nem regisztrál. Megmutatja a weboldal által küldött API kérést is.",
          "Buszkapitány, beléptető és vendég nézet: valódi adatokat mutat, de semmit nem ment.",
          "Kioszk: a tableten megjelenő képernyő. A próbaválaszok nem kerülnek az eredmények közé.",
        ],
      },
    ],
  },
  {
    id: "weboldal",
    title: "Weboldal és API",
    summary: "Hogyan kapcsolódik a weboldal a tBookhoz.",
    permissions: ["group:apiKey"],
    links: [{ href: "/admin/groups", label: "Eseménycsoportok" }],
    sections: [
      {
        heading: "API kulcs",
        steps: [
          "Eseménycsoportok → csoport → API key: hozz létre kulcsot, és add át a weboldal fejlesztőjének. A kulcs csak a saját csoportja eseményeit látja.",
          "A weboldal ugyanazt az űrlapot jeleníti meg, amit itt összeállítasz. Az első lépés (azonosító alapú kitöltés) a POST /api/v1/events/{eventId}/prefill hívással működik.",
          "A fejlesztői leírás: docs/storefront-api.md a tBook repóban.",
        ],
      },
    ],
  },
];
