import type { Locale } from "./i18n/types";

export type CourseMediaItem = {
  id: string;
  title: string;
  description?: string;
  src: string;
  provider?: "internal" | "kinescope";
  drmProtected?: boolean;
  durationMin?: number;
};

export type CourseTextItem = {
  id: string;
  title: string;
  description?: string;
  href: string;
};

export type CourseModule = {
  id: string;
  title: string;
  summary: string;
  lessons: Array<{
    id: string;
    title: string;
  }>;
};

export type CourseAuthor = {
  name: string;
  bio: string;
  experienceLabel?: string;
  geographyLabel?: string;
  educationLabel?: string;
};

export type CourseItem = {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  titleTranslations?: {
    ru?: string;
    en?: string;
  };
  subtitleTranslations?: {
    ru?: string;
    en?: string;
  };
  heroImageSrc?: string;
  description?: string;
  tagline?: string;
  scheduleLabel?: string;
  durationLabel?: string;
  formatLabel?: string;
  audience: string[];
  outcomes: string[];
  modules: CourseModule[];
  bonuses: string[];
  author?: CourseAuthor;
  faq: string[];
  coursePlaylistUrl?: string;
  premiumEntitlementCode?: string;
  freeVideos: CourseMediaItem[];
  premiumVideos: CourseMediaItem[];
  freeAudios: CourseMediaItem[];
  premiumAudios: CourseMediaItem[];
  freeTexts: CourseTextItem[];
  premiumTexts: CourseTextItem[];
};

export const COURSE_ITEMS: CourseItem[] = [
  {
    id: "course-porushka-foundation",
    slug: "porushka-foundation",
    title: "Курс «Порушка»: база и надстройка",
    subtitle: "Базовые материалы открыты всем, углублённые материалы доступны по подписке",
    titleTranslations: {
      en: "Porushka Course: Foundation and Extended Access",
    },
    subtitleTranslations: {
      en: "Foundation materials are public, advanced modules are available with subscription",
    },
    heroImageSrc: "/hero.jpg",
    description:
      "Курс для разбора жанра, манеры, исторических слоёв и практики исполнения. В premium доступны дополнительные дорожки и видео-разборы.",
    tagline: "База для входа в материал и безопасного развития голоса.",
    scheduleLabel: "Свободный старт, самостоятельное прохождение.",
    durationLabel: "Формат по собственному темпу.",
    formatLabel: "Видео + аудио + текстовые методички.",
    audience: [
      "Начинающие исполнители, которые хотят войти в жанр.",
      "Поющие участники ансамблей, которым нужна структура и системность.",
      "Преподаватели и руководители коллективов для расширения методической базы.",
    ],
    outcomes: [
      "Понимание структуры материала и логики разборов.",
      "Навык послойной работы с дорожками и фразировкой.",
      "Готовая база для перехода к расширенным модулям.",
    ],
    modules: [
      {
        id: "porushka-m1",
        title: "Базовый модуль",
        summary: "Введение в материал, жанровый контекст, первая практика.",
        lessons: [
          { id: "porushka-m1-l1", title: "Введение в материал" },
          { id: "porushka-m1-l2", title: "Базовая дорожка и стартовая практика" },
        ],
      },
      {
        id: "porushka-m2",
        title: "Расширенный модуль",
        summary: "Форма, вариативность и работа с архивным пластом.",
        lessons: [
          { id: "porushka-m2-l1", title: "Разбор формы и вариативности" },
          { id: "porushka-m2-l2", title: "Архивный пласт и сценическая адаптация" },
        ],
      },
    ],
    bonuses: [
      "Дополнительные дорожки для самостоятельной проработки.",
      "Пошаговые планы практики по блокам.",
    ],
    author: {
      name: "Евгений Багринцев",
      bio: "Музыкант, вокалист, исследователь традиционной культуры.",
    },
    faq: [
      "Можно проходить в удобном темпе и возвращаться к материалам.",
      "Базовые материалы доступны без подписки, расширенные — по доступу.",
    ],
    coursePlaylistUrl: "https://kinescope.io/pl/udmfTHtJesu19FKwakMasx",
    premiumEntitlementCode: "course:porushka-foundation:access",
    freeVideos: [
      {
        id: "v-free-01",
        title: "Введение в материал",
        description: "Короткий вводный разбор традиции и структуры занятия.",
        src: "/video/porushka/por-video-1984-newsday.mp4",
        provider: "internal",
        durationMin: 6,
      },
    ],
    premiumVideos: [
      {
        id: "v-prem-01",
        title: "Разбор формы и вариативности",
        description: "Подробный разбор схемы и переходов по фразам.",
        src: "/video/porushka/por-video-1981-chronicle.mp4",
        provider: "internal",
        durationMin: 12,
      },
      {
        id: "v-prem-02",
        title: "Архивный пласт и сценическая адаптация",
        description: "Сопоставление архивных записей и современной практики.",
        src: "/video/porushka/por-video-festival-1993.mp4",
        provider: "internal",
        durationMin: 10,
      },
    ],
    freeAudios: [
      {
        id: "a-free-01",
        title: "Базовая дорожка 1",
        description: "Опорная партия для самостоятельного пропева.",
        src: "/audio/kemerov_varyuhino-gulenka/kemerov_varyuhino-gulenka-01.mp3",
        provider: "internal",
      },
    ],
    premiumAudios: [
      {
        id: "a-prem-01",
        title: "Дополнительная учебная дорожка 1",
        description: "Изолированная партия для послойного обучения.",
        src: "/audio/bolshoy_kunaliy-chto_ty_vanya/bolshoy_kunaliy-chto_ty_vanya-03.mp3",
        provider: "internal",
      },
      {
        id: "a-prem-02",
        title: "Дополнительная учебная дорожка 2",
        description: "Вариант с акцентом на фразировку.",
        src: "/audio/bolshoy_kunaliy-chto_ty_vanya/bolshoy_kunaliy-chto_ty_vanya-04.mp3",
        provider: "internal",
      },
    ],
    freeTexts: [
      {
        id: "t-free-01",
        title: "Открытая статья по теме",
        description: "Краткий обзор и контекст материала.",
        href: "/articles/oi-ty-porushka-paranya",
      },
    ],
    premiumTexts: [
      {
        id: "t-prem-01",
        title: "Расширенный конспект занятия",
        description: "Пошаговый план индивидуальной практики.",
        href: "/articles/oi-ty-porushka-paranya",
      },
    ],
  },
  {
    id: "course-vocal-fundamentals",
    slug: "vocal-fundamentals",
    title: "Видеокурс «Основы народного вокала»",
    subtitle: "Начните петь свободно, безопасно и в свое удовольствие",
    titleTranslations: {
      en: "Video Course: Fundamentals of Folk Vocal",
    },
    subtitleTranslations: {
      en: "Start singing freely, safely, and with joy",
    },
    heroImageSrc: "/hero.jpg",
    description:
      "Курс по «Основам вокала» сочетает теоретическую выжимку и практику: помогает диагностировать голосовые сложности, подобрать рабочий алгоритм и выстроить устойчивую технику. Петь может каждый.",
    tagline: "Начните петь свободно, безопасно и в свое удовольствие.",
    scheduleLabel: "03 ноября – 15 декабря 2025. Возможен индивидуальный старт и прохождение.",
    durationLabel: "6 недель, 33 урока, около 500 минут видео.",
    formatLabel: "Видеоуроки + обратная связь в чате.",
    audience: [
      "Начинающие, которые хотят научиться понимать свой голос и работать с ним.",
      "Опытные поющие, у кого есть пробелы в знаниях или нерешенные голосовые проблемы.",
      "Преподаватели вокала и ансамблевого пения, которые хотят усилить профессиональные компетенции.",
    ],
    outcomes: [
      "Уверенность в голосе и внимательное отношение к голосовому аппарату.",
      "Понимание вокальных основ и рычагов управления звучанием.",
      "Навык самодиагностики зажимов и проблемных зон.",
      "Более красивое и выносливое звучание с меньшими энергозатратами.",
      "Освоение дыхания, координации тела, артикуляции и дикции.",
      "Комплексы упражнений: дыхание, атака, формирование звука от простого к сложному.",
      "Фразовая работа, динамика и более мелодичное пение.",
      "Закрепление через 4 песни и обратную связь на значимых этапах.",
    ],
    modules: [
      {
        id: "vocal-fundamentals-m1",
        title: "Введение в основы вокала (9 уроков)",
        summary:
          "Знакомство с телом через теорию и практику: диагностика зажимов, три параметра управления голосом, резонаторы и поиск баланса.",
        lessons: [
          { id: "001", title: "Введение в основы вокала" },
          { id: "002", title: "Работа резонаторов и поиск баланса" },
          { id: "003", title: "Челюсть, язык, губы. Упражнения" },
          { id: "004", title: "Разминочный блок" },
          { id: "005", title: "Работа дыхания" },
          { id: "006", title: "Дыхание. Атака звука" },
          { id: "007", title: "Блок упражнений: дыхание и атака" },
          { id: "008", title: "Артикуляция, губы, язык. Поиск баланса" },
          { id: "009", title: "Артикуляция: работа губ" },
        ],
      },
      {
        id: "vocal-fundamentals-m2",
        title: "Вокальная позиция. Поиск баланса (8 уроков)",
        summary: "Звукоэталон, слабые стороны, баланс резонаторов и единая позиция пения.",
        lessons: [
          { id: "010", title: "Два метода работы со слухом" },
          { id: "011", title: "Напряжение тела и реакция организма" },
          { id: "012", title: "Пение внизу и вверху как в среднем диапазоне" },
          { id: "013", title: "Баланс и поиск высокой позиции" },
          { id: "014", title: "Великаний голос. Зона груди" },
          { id: "015", title: "Поиск высокой позиции. Работа от противного" },
          { id: "016", title: "Соединение резонаторов" },
          { id: "017", title: "Выводим звук из носа" },
        ],
      },
      {
        id: "vocal-fundamentals-m3",
        title: "От распевки к песне (12 уроков)",
        summary:
          "Координация артикуляции и дыхания, переход к песням, закрепление и фразовая работа нескольких уровней.",
        lessons: [
          { id: "018", title: "Распевки (разогрев и тренаж)" },
          { id: "019", title: "Формирование согласного звука в позиции" },
          { id: "020", title: "Согласные. Координация с дыханием" },
          { id: "021", title: "Вдоль по морю, морю синему. Применение приемов" },
          { id: "022", title: "Принцип острой подачи звука" },
          { id: "023", title: "4 уровня острого выговаривания. Отработка на песне" },
          { id: "024", title: "Фразовая работа. Расстановка акцентов" },
          { id: "025", title: "Фразовая работа. Динамика" },
          { id: "026", title: "Динамическое изменение звука. Блок упражнений на атаку" },
          { id: "027", title: "Горе мое, горе" },
          { id: "028", title: "Да в саду дерево цветет" },
          { id: "029", title: "Ты заря моя, ты зоренька" },
        ],
      },
      {
        id: "vocal-fundamentals-m4",
        title: "Особенности фольклорного звука (4 урока + заключение)",
        summary:
          "Разбор универсальных принципов в региональном разнообразии, мужского и женского звучания, финальное закрепление.",
        lessons: [
          { id: "030", title: "Особенности фольклорного звука. Примеры по одному региону" },
          { id: "031", title: "Фольклорный звук. Юг-Север. Особенности работы челюсти" },
          { id: "032", title: "Фольклорный звук. Мужское и женское в одной традиции" },
          { id: "033", title: "Вспоминание упражнений и заключение" },
        ],
      },
    ],
    bonuses: [
      "Аудиодорожки для тренировки пройденных упражнений.",
      "Дополнительный набор многоголосных народных песен с выделением каждого голоса.",
      "Подборка этнографических записей, на которых строится 4-й блок.",
    ],
    author: {
      name: "Багринцев Евгений Игоревич",
      bio:
        "Музыкант, вокалист, этномузыколог, исследователь и популяризатор традиционной народной культуры, блогер, отец троих детей.",
      experienceLabel: "Опыт преподавания: 11 лет.",
      geographyLabel:
        "География учеников: крупные города России, США, Канада, Германия, Великобритания, Литва, Норвегия, Дания, Израиль, Бразилия, Перу.",
      educationLabel:
        "Образование: СПбГК им. Н.А. Римского-Корсакова; Омский музыкальный колледж им. В.Я. Шебалина.",
    },
    faq: [
      "Курс подходит и новичкам с нулевым опытом, и людям с большим вокальным опытом.",
      "Заниматься можно в удобное для себя время.",
      "Обратную связь можно получать по мере прохождения курса.",
      "Оплата возможна целиком или частями, в том числе из-за рубежа.",
      "Сертификат государственного образца не выдается, но доступен памятный сертификат с подписью.",
      "Доступ к материалам не ограничен по времени.",
      "Курс формирует фундамент для дальнейшего развития вокальных возможностей.",
    ],
    coursePlaylistUrl: "https://kinescope.io/pl/687gYytdnJF583WXnXwzqQ",
    premiumEntitlementCode: "course:vocal:full",
    freeVideos: [
      {
        id: "vocal-001",
        title: "001. Введение в основы вокала",
        description: "Открытый ознакомительный урок.",
        src: "https://kinescope.io/trpyn8CQS8QR2WCj5WSRMC",
        provider: "kinescope",
        drmProtected: true,
      },
    ],
    premiumVideos: [
      { id: "vocal-002", title: "002. Работа резонаторов и поиск баланса", src: "https://kinescope.io/oFXMH6HUcRVrcbquYku4vh", provider: "kinescope", drmProtected: true },
      { id: "vocal-003", title: "003. Челюсть, язык, губы. Упражнения", src: "https://kinescope.io/hUGtn1y96jqnCAbCFGS82s", provider: "kinescope", drmProtected: true },
      { id: "vocal-004", title: "004. Разминочный блок", src: "https://kinescope.io/qGu2BJaSTwabkTZAA9YGx7", provider: "kinescope", drmProtected: true },
      { id: "vocal-005", title: "005. Работа дыхания", src: "https://kinescope.io/9UsnzFjDvo2KEpN5KgX4kC", provider: "kinescope", drmProtected: true },
      { id: "vocal-006", title: "006. Дыхание. Атака звука", src: "https://kinescope.io/cMWjxRbtwbCC1bKNV5wSGL", provider: "kinescope", drmProtected: true },
      { id: "vocal-007", title: "007. Блок упражнений: дыхание и атака", src: "https://kinescope.io/631oQznT8LU47mHoGsyQkC", provider: "kinescope", drmProtected: true },
      { id: "vocal-008", title: "008. Артикуляция, работа губ, положение языка. Поиск баланса", src: "https://kinescope.io/7o4wQS32eps6YKnfv6bYzm", provider: "kinescope", drmProtected: true },
      { id: "vocal-009", title: "009. Артикуляция: работа губ", src: "https://kinescope.io/tGxQ8Hk7ARNRUqNZEnQ9SB", provider: "kinescope", drmProtected: true },
      { id: "vocal-010", title: "010. Два метода работы со слухом", src: "https://kinescope.io/jhBsaPeMp567TaNzrRr39p", provider: "kinescope", drmProtected: true },
      { id: "vocal-011", title: "011. Напряжение тела и реакция организма", src: "https://kinescope.io/dZfU39hAkU8UDV77ScV3nr", provider: "kinescope", drmProtected: true },
      { id: "vocal-012", title: "012. Поем внизу и вверху как в среднем диапазоне", src: "https://kinescope.io/94cdrKMwtnsbqNSkWzp6FA", provider: "kinescope", drmProtected: true },
      { id: "vocal-013", title: "013. Баланс и поиск высокой позиции", src: "https://kinescope.io/mWe2xbu3fQJfXjfTotzWoM", provider: "kinescope", drmProtected: true },
      { id: "vocal-014", title: "014. Великаний голос. Зона груди", src: "https://kinescope.io/ffGFYgHNwqXTN71yMVaBoP", provider: "kinescope", drmProtected: true },
      { id: "vocal-015", title: "015. Поиск высокой позиции. Работа от противного", src: "https://kinescope.io/2vGFUnaVB8b23RLX3TvMsn", provider: "kinescope", drmProtected: true },
      { id: "vocal-016", title: "016. Соединение резонаторов", src: "https://kinescope.io/nUeA4x766J7zknBC3W7t8e", provider: "kinescope", drmProtected: true },
      { id: "vocal-017", title: "017. Выводим звук из носа", src: "https://kinescope.io/cmiY8as3Ug2iLDZCc7qGcD", provider: "kinescope", drmProtected: true },
      { id: "vocal-018", title: "018. Распевки (разогрев и тренаж)", src: "https://kinescope.io/cLneEAMpQ1oqiJNosobHVP", provider: "kinescope", drmProtected: true },
      { id: "vocal-019", title: "019. Формирование согласного звука в позиции", src: "https://kinescope.io/tzp8i6r6b6RaUnv6Mk9h4B", provider: "kinescope", drmProtected: true },
      { id: "vocal-020", title: "020. Согласные. Координация с дыханием", src: "https://kinescope.io/fAxvFh5Pk2FexXCrEcHBae", provider: "kinescope", drmProtected: true },
      { id: "vocal-021", title: "021. Вдоль по морю, морю синему. Применение приемов", src: "https://kinescope.io/8ZppWW4E7XM7L8JThJ7Yow", provider: "kinescope", drmProtected: true },
      { id: "vocal-022", title: "022. Принцип острой подачи звука", src: "https://kinescope.io/p8XaMFXKw19sDRRDMdZWqf", provider: "kinescope", drmProtected: true },
      { id: "vocal-023", title: "023. 4 уровня острого выговаривания. Отработка на песне", src: "https://kinescope.io/6esqGct4ggc7oCyPvdMFnc", provider: "kinescope", drmProtected: true },
      { id: "vocal-024", title: "024. Фразовая работа. Расстановка акцентов", src: "https://kinescope.io/uvXCJQ1Xz7nTWWCQ8t1rfs", provider: "kinescope", drmProtected: true },
      { id: "vocal-025", title: "025. Фразовая работа. Динамика", src: "https://kinescope.io/5wpLt1C9LnWimaxtZ6p4h6", provider: "kinescope", drmProtected: true },
      { id: "vocal-026", title: "026. Динамическое изменение звука. Блок упражнений на атаку", src: "https://kinescope.io/4fTmShkKvs8soTC4dY7U79", provider: "kinescope", drmProtected: true },
      { id: "vocal-027", title: "027. Горе мое, горе", src: "https://kinescope.io/iwV7expKKetdcdv5dAMBEh", provider: "kinescope", drmProtected: true },
      { id: "vocal-028", title: "028. Да в саду дерево цветет", src: "https://kinescope.io/ivLfvYYFJYUDTKehMxNXnE", provider: "kinescope", drmProtected: true },
      { id: "vocal-029", title: "029. Ты заря моя, ты зоренька", src: "https://kinescope.io/0dKKQ2dqkcSLzzc3zSE7sQ", provider: "kinescope", drmProtected: true },
      { id: "vocal-030", title: "030. Особенности фольклорного звука. Примеры по одному региону", src: "https://kinescope.io/wsJ8FHFBYZkD22WdiD1NjY", provider: "kinescope", drmProtected: true },
      { id: "vocal-031", title: "031. Фольклорный звук. Юг-Север. Особенности работы челюсти", src: "https://kinescope.io/8qAKRaRtDqCChabv1zT9Lt", provider: "kinescope", drmProtected: true },
      { id: "vocal-032", title: "032. Фольклорный звук. Мужское и женское в одной традиции", src: "https://kinescope.io/8VRNnK6RbNmrgzYQs2eKU4", provider: "kinescope", drmProtected: true },
      { id: "vocal-033", title: "033. Вспоминание упражнений", src: "https://kinescope.io/c2H3UHdxvrbhYXCTE326NR", provider: "kinescope", drmProtected: true },
    ],
    freeAudios: [],
    premiumAudios: [],
    freeTexts: [
      {
        id: "vocal-text-free-01",
        title: "Структура курса по модулям",
        description: "Программа блоков и результаты по каждому этапу.",
        href: "/materials/vocal-course-pro",
      },
    ],
    premiumTexts: [
      {
        id: "vocal-text-prem-01",
        title: "Плейлист курса на Kinescope (DRM)",
        description: "Полный плейлист для подписчиков.",
        href: "https://kinescope.io/pl/687gYytdnJF583WXnXwzqQ",
      },
    ],
  },
  {
    id: "course-kolyadki-1",
    slug: "kolyadki-course-1",
    title: "Колядки. Видеокурс №1",
    subtitle: "От простого к сложному: 5 песен и бонусные видео",
    titleTranslations: {
      en: "Kolyadki: Video Course #1",
    },
    subtitleTranslations: {
      en: "From simple to complex: 5 songs plus bonus videos",
    },
    heroImageSrc: "/hero.jpg",
    description:
      "Практический курс по колядкам для начинающих: показ напева, пропевание целиком, диалектный текст, комментарии и разбор голосов. В материалы встроены DRM-видео Kinescope.",
    tagline: "5 песен, постепенное усложнение и разбор голосов по шагам.",
    scheduleLabel: "Индивидуальный старт и прохождение в удобном темпе.",
    durationLabel: "Базовый блок ~1ч20м + дополнительные видео.",
    formatLabel: "Видеоуроки + этнографические аудиопримеры в материалах.",
    audience: [
      "Начинающие, которым нужен понятный вход в колядки.",
      "Поющие, кто хочет разучить материал по голосам от простого к сложному.",
      "Руководители коллективов и педагоги для практического репертуара.",
    ],
    outcomes: [
      "Понимание опорного напева и структуры 5 песен.",
      "Навык пения по голосам с постепенным усложнением.",
      "Освоение диалектного текста и базовых вариантов исполнения.",
      "Готовый материал для самостоятельной и групповой практики.",
    ],
    modules: [
      {
        id: "kolyadki-m1",
        title: "Основной блок: 5 песен",
        summary:
          "Пошаговый разбор колядок с региональным материалом, пропеванием целиком и комментариями.",
        lessons: [
          { id: "k-001", title: "Коледы-моледы — с. Усть-Цильма, Республика Коми (1*)" },
          { id: "k-002", title: "Авсень дуда — с. Сырское, Липецкая область (1*)" },
          { id: "k-003", title: "Как пришла Коляда (Авсень) — с. Митягино, Липецкая область (1.5*)" },
          { id: "k-004", title: "И шла Коляда — Брянская область, д. Манцурово (1.5*)" },
          { id: "k-005", title: "Ходють-бродють колядовщики (Виноградье) — Белгородская область (2.5*)" },
        ],
      },
      {
        id: "kolyadki-m2",
        title: "Дополнительные видео",
        summary: "Дополнительные пояснения и расширенные разборы по материалу курса.",
        lessons: [
          { id: "k-bonus-01", title: "Дополнительный видеоразбор №1" },
          { id: "k-bonus-02", title: "Дополнительный видеоразбор №2" },
        ],
      },
    ],
    bonuses: [
      "Этнографический звук в приложениях к видео.",
      "Письменные комментарии к каждому блоку.",
      "Дополнительные видео для закрепления.",
    ],
    author: {
      name: "Багринцев Евгений Игоревич",
      bio:
        "Музыкант, вокалист, этномузыколог, исследователь и популяризатор традиционной народной культуры, преподаватель.",
      experienceLabel: "Опыт преподавания: 11 лет.",
    },
    faq: [
      "Курс подходит начинающим благодаря градации сложности (1* -> 2.5*).",
      "Можно заниматься в удобное время и возвращаться к урокам.",
      "Материалы курса доступны через защищенные DRM-видео Kinescope.",
    ],
    coursePlaylistUrl: "https://kinescope.io/pl/udmfTHtJesu19FKwakMasx",
    premiumEntitlementCode: "course:kolyadki:full",
    freeVideos: [
      {
        id: "kolyadki-001",
        title: "Коледы-моледы (ознакомительный урок)",
        description: "Открытый урок из базового блока.",
        src: "https://kinescope.io/28QqTGpufyRq3HoTKLZnVu",
        provider: "kinescope",
        drmProtected: true,
      },
    ],
    premiumVideos: [
      { id: "kolyadki-002", title: "Авсень дуда", src: "https://kinescope.io/gwrDsueru4g1CEHD2azsXD", provider: "kinescope", drmProtected: true },
      { id: "kolyadki-003", title: "Как пришла Коляда (Авсень)", src: "https://kinescope.io/9ejAe8HcTaA6U4QaiQbwLG", provider: "kinescope", drmProtected: true },
      { id: "kolyadki-004", title: "И шла Коляда", src: "https://kinescope.io/hy3AaXCgEvZtJjwu5tdDq8", provider: "kinescope", drmProtected: true },
      { id: "kolyadki-005", title: "Ходють-бродють колядовщики", src: "https://kinescope.io/9sUzCmfzFsctMunijyAc9U", provider: "kinescope", drmProtected: true },
      { id: "kolyadki-006", title: "Дополнительный разбор из курса", src: "https://kinescope.io/nw4AYkdku6o4w1jofmjqLm", provider: "kinescope", drmProtected: true },
      { id: "kolyadki-bonus-01", title: "Дополнительное видео №1", src: "https://kinescope.io/3RHyfTZrewDuzMNmmZUVGq", provider: "kinescope", drmProtected: true },
      { id: "kolyadki-bonus-02", title: "Дополнительное видео №2", src: "https://kinescope.io/asVwYLpGjAQCjvH1HBo2Le", provider: "kinescope", drmProtected: true },
    ],
    freeAudios: [],
    premiumAudios: [],
    freeTexts: [
      {
        id: "kolyadki-text-free-01",
        title: "Описание курса и уровни сложности",
        description: "Краткий обзор программы и сложности по песням.",
        href: "/materials/kolyadki-course-1",
      },
    ],
    premiumTexts: [
      {
        id: "kolyadki-text-prem-01",
        title: "Плейлист курса на Kinescope (DRM)",
        description: "Полный плейлист для участников с доступом.",
        href: "https://kinescope.io/pl/udmfTHtJesu19FKwakMasx",
      },
    ],
  },
];

export function getCourseBySlug(slug: string): CourseItem | undefined {
  return COURSE_ITEMS.find((item) => item.slug === slug);
}

export function getCourseTitle(course: CourseItem, locale: Locale): string {
  return course.titleTranslations?.[locale] || course.title;
}

export function getCourseSubtitle(course: CourseItem, locale: Locale): string {
  return course.subtitleTranslations?.[locale] || course.subtitle || "";
}

export function getCoursePremiumEntitlementCode(course: CourseItem): string | null {
  const hasPremiumContent =
    course.premiumVideos.length > 0 || course.premiumAudios.length > 0 || course.premiumTexts.length > 0;
  if (!hasPremiumContent) return null;
  return course.premiumEntitlementCode || `course:${course.slug}:access`;
}

export function getCourseByEntitlementCode(entitlementCode: string): CourseItem | undefined {
  const normalized = entitlementCode.trim();
  if (!normalized) return undefined;
  return COURSE_ITEMS.find((course) => getCoursePremiumEntitlementCode(course) === normalized);
}
