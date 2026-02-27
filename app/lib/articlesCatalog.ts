import type { Locale } from "./i18n/types";

export type ArticleAudio = {
  title: string;
  src: string;
  note?: string;
};

export type ArticleTextAlign = "left" | "center" | "right";
export type ArticleMediaAlign = "left" | "right" | "center" | "full";
export type ArticleMediaSize = "sm" | "md" | "lg";
export type ArticleVkFigureType = 100 | 101 | 102 | 105;
export type ArticleVkGroupRole = "first" | "middle" | "last" | "single";
export type ArticleVkMeta = {
  vkType?: ArticleVkFigureType;
  vkMode?: 0 | 1;
  vkGroupRole?: ArticleVkGroupRole;
  vkClassName?: string;
};

export type ArticleSection = {
  heading?: string;
  paragraphs: string[];
  audios?: ArticleAudio[];
};

export type ArticleTextBlock = {
  id: string;
  type: "text";
  html: string;
  align?: ArticleTextAlign;
  fontScale?: "sm" | "md" | "lg";
} & ArticleVkMeta;

export type ArticleQuoteBlock = {
  id: string;
  type: "quote";
  text: string;
  author?: string;
} & ArticleVkMeta;

export type ArticleImageBlock = {
  id: string;
  type: "image";
  src: string;
  caption?: string;
  align?: ArticleMediaAlign;
  size?: ArticleMediaSize;
  wrap?: boolean;
} & ArticleVkMeta;

export type ArticleAudioBlock = {
  id: string;
  type: "audio";
  src: string;
  title: string;
  caption?: string;
} & ArticleVkMeta;

export type ArticleVideoBlock = {
  id: string;
  type: "video";
  src: string;
  title?: string;
  caption?: string;
  align?: ArticleMediaAlign;
  size?: ArticleMediaSize;
  wrap?: boolean;
} & ArticleVkMeta;

export type ArticleOrderedListBlock = {
  id: string;
  type: "ordered_list";
  items: string[];
  start?: number;
} & ArticleVkMeta;

export type ArticleTableBlock = {
  id: string;
  type: "table";
  caption?: string;
  bordered?: boolean;
  rows: string[][];
} & ArticleVkMeta;

export type ArticlePlaylistBlock = {
  id: string;
  type: "playlist";
  title?: string;
  songSlugs: string[];
} & ArticleVkMeta;

export type ArticleBlock =
  | ArticleTextBlock
  | ArticleQuoteBlock
  | ArticleImageBlock
  | ArticleAudioBlock
  | ArticleVideoBlock
  | ArticleOrderedListBlock
  | ArticleTableBlock
  | ArticlePlaylistBlock;

export type ArticleItem = {
  slug: string;
  title: string;
  subtitle: string;
  titleTranslations?: {
    ru: string;
    en?: string;
  };
  subtitleTranslations?: {
    ru: string;
    en?: string;
  };
  coverImage?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  publishedAt?: string;
  sections: ArticleSection[];
  blocks?: ArticleBlock[];
};

const PORUSHKA_AUDIO_BASE = "/audio/porushka_test/mapped";
const porushkaAudioSrc = (fileName: string) => `${PORUSHKA_AUDIO_BASE}/${fileName}`;

const PORUSHKA_AUDIO_SRC_BY_TITLE: Record<string, string> = {
  "Ариэль — Порушка-Параня": porushkaAudioSrc("por-01-ariel.mp3"),
  "Звери и Надежда Бабкина — Порушка-Параня": porushkaAudioSrc("por-02-zveri-babkina.mp3"),
  "Александр Пушной — Порушка-Поранья": porushkaAudioSrc("por-03-pushnoy.mp3"),
  "Ансамбль Дмитрия Покровского — Ох, ты порушка пораня": porushkaAudioSrc("por-04-pokrovsky.mp3"),
  "Мужики с. Нижняя Покровка — Порушка Параня": porushkaAudioSrc("por-05-nizhnya-pokrovka.mp3"),
  "с. Афанасьевка — Уж ты, Порушка-Поранья": porushkaAudioSrc("por-07-afanasyevka-uzh-ty.mp3"),
  "с. Афанасьевка — Порушка-Параня": porushkaAudioSrc("por-06-afanasyevka-porushka-poranya.mp3"),
  "Сапелкин Ефим Тарасович — Порушка-Параня соло": porushkaAudioSrc("por-08-sapelkin-solo.mp3"),
  "Песни с. Афанасьевка — Ох, уж ты Порушка, Параня": porushkaAudioSrc("por-09-afanasyevka-oh-uzh-ty.mp3"),
  "Белгород, Афанасьевка — Порушка": porushkaAudioSrc("por-10-afanasyevka-porushka-short.mp3"),
  "001. Общее звучание — Зап. Щуров В.М., Чекарева Е.": porushkaAudioSrc("por-11-channel-001.mp3"),
  "002. Исп. Флигинских Татьяна Давыдовна, 1931": porushkaAudioSrc("por-12-channel-002.mp3"),
  "003. Исп. Костенникова Ксения Федотовна, 1933": porushkaAudioSrc("por-13-channel-003.mp3"),
  "004. Исп. Сапелкин Иван Тарасьевич, 1919": porushkaAudioSrc("por-14-channel-004.mp3"),
  "Ансамбли сёл Иловка и Подсереднее — Porushka, Paranya": porushkaAudioSrc("por-15-ilovka-podserednee.mp3"),
  "Подсереднее, Колядина Мария Митрофановна — Порушка": porushkaAudioSrc("por-16-podserednee-porushka.mp3"),
  "Бузулук — Из-за леса, из-за гор": porushkaAudioSrc("por-17-buzuluk.mp3"),
  "Казачий хор станицы Усть-Бузулукской — Из-за леса, из-за гор": porushkaAudioSrc("por-18-ust-buzuluk.mp3"),
  "Казачьи плясовые — Из-за леса из-за гор": porushkaAudioSrc("por-19-kazachyi-plyasovye.mp3"),
  "ст. Старопавловская — Шел я улком-переулком": porushkaAudioSrc("por-20-staropavlovskaya.mp3"),
  "Казачий Круг — Уж ты, Дуня-Дуняша": porushkaAudioSrc("por-21-kazachiy-krug.mp3"),
  "ст. Глазуновская — Уж ты Дуня": porushkaAudioSrc("por-22-glazunovskaya.mp3"),
  "х. Становский — Ой, Дуня, барыня": porushkaAudioSrc("por-23-stanovskiy.mp3"),
  "Ансамбль «Кубаночка» — Ой, Дуня, Дуня": porushkaAudioSrc("por-24-kubanochka.mp3"),
  "Багринцев Евгений — 01. Разбор схемы песни": porushkaAudioSrc("por-25-bagrintsev-01.mp3"),
  "Багринцев Евгений — 02. Разбор середины и низа": porushkaAudioSrc("por-26-bagrintsev-02.mp3"),
  "Багринцев Евгений — 03. Разбор низа": porushkaAudioSrc("por-27-bagrintsev-03.mp3"),
  "Багринцев Евгений — 04. Разбор основного голоса": porushkaAudioSrc("por-28-bagrintsev-04.mp3"),
};

const resolvePorushkaAudioSrc = (title: string) => PORUSHKA_AUDIO_SRC_BY_TITLE[title] ?? "";
const vkGroupRoleAt = (index: number, total: number): ArticleVkGroupRole => {
  if (total <= 1) return "single";
  if (index === 0) return "first";
  if (index === total - 1) return "last";
  return "middle";
};

const PORUSHKA_POP_AUDIO: Array<{ title: string; caption: string }> = [
  { title: "Ариэль — Порушка-Параня", caption: "3:32" },
  { title: "Звери и Надежда Бабкина — Порушка-Параня", caption: "3:14" },
  { title: "Александр Пушной — Порушка-Поранья", caption: "4:08" },
];

const PORUSHKA_CORE_AUDIO: Array<{ title: string; caption: string }> = [
  { title: "Мужики с. Нижняя Покровка — Порушка Параня", caption: "1:15" },
  { title: "с. Афанасьевка — Уж ты, Порушка-Поранья", caption: "2:21" },
  { title: "с. Афанасьевка — Порушка-Параня", caption: "5:58" },
  { title: "Сапелкин Ефим Тарасович — Порушка-Параня соло", caption: "5:22" },
  { title: "Песни с. Афанасьевка — Ох, уж ты Порушка, Параня", caption: "1:41" },
  { title: "Белгород, Афанасьевка — Порушка", caption: "1:48" },
];

const PORUSHKA_CHANNEL_AUDIO: Array<{ title: string; caption: string }> = [
  { title: "001. Общее звучание — Зап. Щуров В.М., Чекарева Е.", caption: "1:23" },
  { title: "002. Исп. Флигинских Татьяна Давыдовна, 1931", caption: "1:30" },
  { title: "003. Исп. Костенникова Ксения Федотовна, 1933", caption: "1:29" },
  { title: "004. Исп. Сапелкин Иван Тарасьевич, 1919", caption: "1:26" },
];

const PORUSHKA_VIDEO_FRAGMENTS: Array<{ title: string; caption: string; src: string }> = [
  {
    title: "1983. Русская песня + ВИА Ариэль",
    caption: "Видеофрагмент (4:56), встроено через YouTube",
    src: "https://youtu.be/FaW4LPaMIIs",
  },
  {
    title: "Реклама «Сникерс» 2009",
    caption: "Видеофрагмент (0:30)",
    src: "/video/porushka/por-video-snickers-2009.mp4",
  },
  {
    title: "Киножурнал Новости дня №13, 1984",
    caption: "Видеофрагмент (1:20), Порушка с 00:28",
    src: "/video/porushka/por-video-1984-newsday.mp4",
  },
  {
    title: "Порушка Параня, с. Малобыково, 1981",
    caption: "Видеофрагмент (0:52), Киножурнал Пионерия №9",
    src: "/video/porushka/por-video-1981-chronicle.mp4",
  },
  {
    title: "с. Веретенниково — фрагмент д/ф Путешествие в традицию",
    caption: "Видеофрагмент (1:03)",
    src: "/video/porushka/por-video-veretenniki.mp4",
  },
  {
    title: "с. Большебыково — фрагмент свадебного обряда",
    caption: "Видеофрагмент (1:44), источник: канал «Главный Механизатор»",
    src: "/video/porushka/por-video-festival-1993.mp4",
  },
  {
    title: "Ансамбль с. Иловка и Подсереднее — Oko",
    caption: "Видеофрагмент (2:26), минифильм OKO / LES FEMMES DE LA TERRE NOIRE",
    src: "/video/porushka/por-video-oko.mp4",
  },
  {
    title: "75-летие Ефима Тарасовича Сапелкина, 1992",
    caption: "Видеофрагмент (3:21), с участием ансамбля Дмитрия Покровского",
    src: "/video/porushka/por-video-1992-sapelkin75.mp4",
  },
];

const PORUSHKA_DUNYA_AUDIO: Array<{ title: string; caption: string }> = [
  { title: "ст. Старопавловская — Шел я улком-переулком", caption: "3:07" },
  { title: "Казачий Круг — Уж ты, Дуня-Дуняша", caption: "3:34" },
  { title: "ст. Глазуновская — Уж ты Дуня", caption: "2:35" },
  { title: "х. Становский — Ой, Дуня, барыня", caption: "3:44" },
  { title: "Ансамбль «Кубаночка» — Ой, Дуня, Дуня", caption: "2:26" },
];

const PORUSHKA_LEARN_AUDIO: Array<{ title: string; caption: string }> = [
  { title: "Багринцев Евгений — 01. Разбор схемы песни", caption: "4:19" },
  { title: "Багринцев Евгений — 02. Разбор середины и низа", caption: "1:41" },
  { title: "Багринцев Евгений — 03. Разбор низа", caption: "1:41" },
  { title: "Багринцев Евгений — 04. Разбор основного голоса", caption: "6:41" },
];

const porushkaBlocks: ArticleBlock[] = [
  {
    id: "por-intro",
    type: "text",
    html:
      "<h2>«Ой ты Порушка-Параня»</h2><p><em>В статье: введение, популярные и неизвестные аудио и видео записи, о сюжете и смысле песни, обучающий материал.</em></p><p>Пожалуй, это самая известная южно-русская карагодная плясовая песня. А может быть и ТОП-10 среди всех известных народных песен. На неё сделано невероятное количество обработок в разных стилях.</p><p>И как же сложно в море «Порушек» найти ту самую — заветную народную песню в её этнографическом, подлинном виде. И так же непросто найти современное исполнение, которое устроило бы большинство.</p>",
    align: "left",
    fontScale: "md",
  },
  ...PORUSHKA_POP_AUDIO.map((item, idx) => ({
    id: `por-pop-audio-${idx + 1}`,
    type: "audio" as const,
    src: resolvePorushkaAudioSrc(item.title),
    title: item.title,
    caption: item.caption,
    vkType: 105 as const,
    vkMode: 0 as const,
    vkGroupRole: vkGroupRoleAt(idx, PORUSHKA_POP_AUDIO.length),
  })),
  {
    id: "por-intro-2",
    type: "text",
    html:
      "<h3>О чем эта песня? Где искать? Кого слушать? Как её учить? (в конце есть материалы)</h3><p>Всем известный вариант песни был записан в 1960-е годы Вячеславом Михайловичем Щуровым в Белгородской области. Конечно же, это песня не одного села, а целого ряда сёл. Да и сам сюжет широко распространён в других регионах под разными «кодовыми» именами.</p><p>Сначала песня исполнялась в деревне — на исторической родине, затем народные музыканты стали привозить её на смотры самодеятельных коллективов и просветительские концерты. Оттуда песня ушла в народ вновь — в 1970-е её подхватили фольклорные и эстрадные коллективы.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-shchurov-photo",
    type: "image",
    src: "/images/articles/porushka/vyacheslav-shchurov.jpg",
    caption: "Вячеслав Михайлович Щуров",
    align: "left",
    size: "md",
    wrap: true,
    vkType: 101,
    vkMode: 1,
    vkGroupRole: "single",
  },
  {
    id: "por-video-1",
    type: "video",
    src: PORUSHKA_VIDEO_FRAGMENTS[0].src,
    title: PORUSHKA_VIDEO_FRAGMENTS[0].title,
    caption: PORUSHKA_VIDEO_FRAGMENTS[0].caption,
    align: "center",
    size: "lg",
    vkType: 102,
    vkMode: 0,
    vkGroupRole: "single",
  },
  {
    id: "por-pokrovsky",
    type: "audio",
    src: resolvePorushkaAudioSrc("Ансамбль Дмитрия Покровского — Ох, ты порушка пораня"),
    title: "Ансамбль Дмитрия Покровского — Ох, ты порушка пораня",
    caption: "3:12",
    vkType: 105,
    vkMode: 0,
    vkGroupRole: "single",
  },
  {
    id: "por-video-2",
    type: "video",
    src: PORUSHKA_VIDEO_FRAGMENTS[1].src,
    title: PORUSHKA_VIDEO_FRAGMENTS[1].title,
    caption: PORUSHKA_VIDEO_FRAGMENTS[1].caption,
    align: "center",
    size: "lg",
    vkType: 102,
    vkMode: 0,
    vkGroupRole: "single",
  },
  {
    id: "por-quote-snickers",
    type: "quote",
    text:
      "У меня сын так заслушался в первый раз, что и не понял — с чем сникерс-то новый?! Это единственная реклама, которую не переключаю сразу.",
    author: "Комментарии 2009 года",
  },
  {
    id: "por-snickers-comments",
    type: "text",
    html:
      "<p>Вот таким хитрым образом «рекламщики» заново привели массового слушателя к песне. Многие впервые услышали «Порушку» именно в этом ролике, а уже потом стали искать народные версии.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-original",
    type: "text",
    html:
      "<h3>Что мы считаем оригиналом — народной песней:</h3><p>Записи сёл Афанасьевка, Иловка, Подсереднее Алексеевского района,<br/>Нижняя Покровка, Большебыково, Малобыково, Стрелецкое Красногвардейского района, Веретенниково Краснинского района<br/>Фощеватово Волоконовского района.</p><p>Народная песня в разных ансамблях звучит то как скандирование, то как перелив. Исполнители-виртуозы постоянно перемещаются, используя огромное количество украшений, приемов, меняют лад и ломают ритм. Верхние голоса могут висеть на одном звуке, или же почти без слов виться соловьями.</p>",
    align: "left",
    fontScale: "md",
  },
  ...PORUSHKA_CORE_AUDIO.map((item, idx) => ({
    id: `por-core-audio-${idx + 1}`,
    type: "audio" as const,
    src: resolvePorushkaAudioSrc(item.title),
    title: item.title,
    caption: item.caption,
    vkType: 105 as const,
    vkMode: 0 as const,
    vkGroupRole: vkGroupRoleAt(idx, PORUSHKA_CORE_AUDIO.length),
  })),
  {
    id: "por-core-text-2",
    type: "text",
    html:
      "<p>Неизменно одно — нижний голос ведет основу, фундамент песни. Средние голоса дают схему и связки, а верхний голос в бесконечном стремлении к прекрасному обыгрывает общее звучание и украшает его.</p><p>Пение сопровождается пляской — пересеком: простой ритм ногами пересекается более сложным. В старину на гулянках снимали воротину, клали на землю, и уже на ней били пересек.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-channels-heading",
    type: "text",
    html:
      "<h3>Уникальные поканальные записи (1979, Зап. Щуров В.М., Чекарева Е.)</h3><p>Ниже сведена разбивка по канальным дорожкам, как в архивной публикации.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-channels-table",
    type: "table",
    caption: "Поканальные дорожки",
    bordered: true,
    rows: [
      ["001", "Общее звучание"],
      ["002", "Флигинских Татьяна Давыдовна, 1931"],
      ["003", "Костенникова Ксения Федотовна, 1933"],
      ["004", "Сапелкин Иван Тарасьевич, 1919"],
    ],
  },
  ...PORUSHKA_CHANNEL_AUDIO.map((item, idx) => ({
    id: `por-channel-audio-${idx + 1}`,
    type: "audio" as const,
    src: resolvePorushkaAudioSrc(item.title),
    title: item.title,
    caption: item.caption,
    vkType: 105 as const,
    vkMode: 0 as const,
    vkGroupRole: vkGroupRoleAt(idx, PORUSHKA_CHANNEL_AUDIO.length),
  })),
  {
    id: "por-videos-intro",
    type: "text",
    html:
      "<h3>Видеофрагменты</h3><p>Видеозаписи с «Порушкой» были вырезаны из различных фильмов и съемок. Для удобства к этим видеофрагментам подготовлены и аудиоверсии.</p>",
    align: "left",
    fontScale: "md",
  },
  ...PORUSHKA_VIDEO_FRAGMENTS.slice(2).map((item, idx) => ({
    id: `por-video-fragment-${idx + 3}`,
    type: "video" as const,
    src: item.src,
    title: item.title,
    caption: item.caption,
    align: "center" as const,
    size: "lg" as const,
    vkType: 102 as const,
    vkMode: 0 as const,
    vkGroupRole: "single" as const,
  })),
  {
    id: "por-other-villages",
    type: "text",
    html:
      "<p>Есть и записи из других сел, однако многое по-прежнему находится в архивах и неизвестно широкой аудитории.</p><p>Версия из села Подсереднее близка к распеву «Мимо моего садика» — ещё одного южнорусского хита.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-other-audio-1",
    type: "audio",
    src: resolvePorushkaAudioSrc("Ансамбли сёл Иловка и Подсереднее — Porushka, Paranya"),
    title: "Ансамбли сёл Иловка и Подсереднее — Porushka, Paranya",
    caption: "2:25",
    vkType: 105,
    vkMode: 0,
    vkGroupRole: "first",
  },
  {
    id: "por-other-audio-2",
    type: "audio",
    src: resolvePorushkaAudioSrc("Подсереднее, Колядина Мария Митрофановна — Порушка"),
    title: "Подсереднее, Колядина Мария Митрофановна — Порушка",
    caption: "3:14",
    vkType: 105,
    vkMode: 0,
    vkGroupRole: "last",
  },
  {
    id: "por-analysis",
    type: "text",
    html:
      "<h3>О чем поётся в Порушке? Или Катеньке, Дунюшке.</h3><p>В этой песни ловко меняются не только имена но и варианты куда сюжет развернется — от неверного мужа, завлечения девушки, до приятных здоровых ухаживаний.</p><p>У нас большой сюжет записанный в селе Афанасьевка Алексеевского района Белгородской области, от него и оттолкнемся в разборе. С одной стороны это набор тем которые можно трактовать отдельно, а можно — вместе.</p><p>Пора (Параня) любит Ваню, он ухаживает за ней и приглашает в гости. А она — идёт. В этом варианте пикантные подробности ночи опущены (отсутствуют) и сюжет переходит душевным переживаниям Ивана. Он признается в любви к замужней женщине — Пора и есть та «чужемужняя» жена. Свою же жену он сравнивает с горькой травой полынью. Образ избитый, но Ивана не остановить. Параня мудро замечает, что у цветиков — любви — есть законное время, мол, где ты был раньше, а теперь уж поздно. Нельзя им быть вместе на людях, а то быстро его — Ивана — «развадят» ходить и любить чужих жён.</p><p>Конечно же, последний текстовый блок в отрыве от остального текста можно и по другому трактовать, как назидание молодым девушкам — если с милым всё быстро дойдет до постели, то он потеряет к вам интерес и перестанет любить.</p><p>Я бы сказал, нам с вами сильно повезло, сюжет вполне логичный, что для карагодных и плясовых песен не всегда норма — ведь одна из задач поплясать, а там текст уже и не настолько важен. В последующих текстах вы сможете это отметить.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-main-lyrics-intro",
    type: "audio",
    src: resolvePorushkaAudioSrc("Сапелкин Ефим Тарасович — Порушка-Параня соло"),
    title: "Сапелкин Ефим Тарасович — Порушка-Параня соло",
    caption: "5:22",
    vkType: 105,
    vkMode: 0,
    vkGroupRole: "single",
  },
  {
    id: "por-main-lyrics",
    type: "text",
    html: "<h3>Текст большого варианта</h3>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-main-lyrics-list",
    type: "ordered_list",
    start: 1,
    items: [
      "Уж ты Порушка-Параня, ты за что любишь Ивана?",
      "Я за то люблю Ивана, что головушка кудрява,",
      "Что головушка кудрява, бородушка кучерява,",
      "Кудри вьются до лица - люблю Ваню-молодца.",
      "Подговаривал Ванюша к сабе (с собой) Пору (Катю) ночевать:",
      "«Ночуй, Пора (Катя), у мене, подарю радость табе,",
      "Подарю Поре (Кате) сирёжачки сиребренаи,",
      "А другие перьвитые, с поднавесочками.",
      "Уповала Паранюшка (Катюшунька) на Ивановы слова,",
      "Ложилася Пора (Катя) спать на Иванову корвать,",
      "Много спала, много нет, много во сне видела,",
      "Будто Ванюшка по горенке похаживая,",
      "Он сапог об сапог приколачивая,",
      "Свои крупнаи речи разговаривая",
      "Уж как ты мене, сударушка, высушила,",
      "Без морозу, без огня сердце вызнобила,",
      "(ой) Пустила сухоту по моём(ы) животу,",
      "(ой) Рассыпала печаль по моим ясным очам,",
      "Присушила чёрны кудри ко больной голове",
      "Ой заставила шатать по чужой стороне,",
      "Приняволила любить чужемужьину жану.",
      "Чужемужьина жана - лебёдушка белая,",
      "А своя (моя) шельма жена - полынь горькея трава.",
      "Ой, полынь, полынь, полынь, всё по межунькям растёт,",
      "Всё по межунькям растёт, по дорожунькям цветёт.",
      "У-во ржи на межи устань, милай, не ляжи",
      "(ох) Не ляжи, не ляжи, да всю (всюю) правду расскажи,",
      "(ох) Расскажи, расскажи, иде цветики цвели",
      "Цвели они, цвяли, не лазорьеваи.",
      "(ой) Нельзя, нельзя, нельзя, нельзя цветика сорвать,",
      "(ой) Нельзя, нельзя, нельзя, нельзя с милым постоять,",
      "(ой) Нельзя, нельзя, нельзя его в гостюшки позвать.",
      "Его в гостюшки позвать - он развадится ходить,",
      "Он развадится ходить и развадится любить.",
    ],
  },
  {
    id: "por-variants",
    type: "text",
    html:
      "<h3>О чем поется в других вариантах этого сюжета:</h3><p>Создать гипертекст который бы логично объединил воедино все варианты невозможно. Сюжеты кочуют из песни в песню, меняются роли, лица, варианты развития событий.<br/>Есть типовые зачины (запевы) и следующий за ним корпус текста. Иногда один и тот же запев или фрагмент текста может начинать разные сюжеты, например как встречающийся в нашем варианте — «из-за леса из-за гор выходила туча-гром».</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-obstacles",
    type: "text",
    html:
      "<h3>Преодоление препятствий и трудностей:</h3><p>На любовном пути парня к девушке могут быть различные трудности:<br/>— обида той самой девушки или отсутствие чувств;<br/>— непогода — сильные дожди, паводки. Кстати, подобных сюжетов много в русской лирике. Как парень (или девушка) пытается добраться до любимой. На пути преграды в виде природных стихий или воды. Иногда это говорится прямо, но чаще иносказательно — и из этого вытекает следующий пункт;<br/>— девушку выдали замуж, парня женили, его отправляют на службу;<br/>— широко проговаривается тема неравного брака. В сюжетах подобного склада зачастую очень подробно описываются «злодеяния» — хитрость, коварство, измена, и даже убийство старого мужа. Народ, и в первую очередь молодежь, пели об этом не от радости и веселья. Это крик души, призыв обществу не допускать подобного. Механизм как в песнях балладного содержания. А иногда и просто попытка выпустить пар.<br/>В таких песнях поётся как прежние возлюбленные мечтают о встрече с друг другом — постоять, поплакать, вспомнить прежнюю жизнь. Или прийти в гости, сад с желанием интима. В одних сюжетах «молодые» останавливаются, а в других — идут до конца.</p><p><strong>Молодецкая смекалка, сила, выносливость и всё ради того, чтобы оказаться рядом с любимой.</strong></p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-quote-obstacles-intro",
    type: "quote",
    text: "«Девчоночка молода раздогадлива была,\nЧерноброва, черноглаза, парня высушила,",
  },
  {
    id: "por-obstacles-bridge",
    type: "text",
    html: "<p>далее про любовь и полынь, приятная рифма про вискИ</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-quote-poetics",
    type: "quote",
    text:
      "Я со этой ли тоски расчешу кудри-виски,\nРасчешу кудри-виски, пойду в темные лески.\nИз-за лесу, из-за гор подымалась туча-гром,\nПодымалась туча-гром со сильныим со дождем;\nКак со этого дождя стала улица грязна,\nСтала улица грязна, в переулочках вода.\nКо сударушке пройти добру молодцу нельзя.\nРазмальчишка молодой, вор догадливый такой,\nСтал канавки прорывать, стал он воду выпущать;\nСтала улица просыхать, стала девушка ходить,\nСтала девушка ходить, хороводы заводить.\nА я мостик намощу, ко сударушке пройду!",
    author: "Саратовская губерния. Костомаров и Мордовцева, стр. 94; Отечественныя Записки 1858 года, №1, стр. 319.",
  },
  {
    id: "por-buzuluk-audio-1",
    type: "audio",
    src: resolvePorushkaAudioSrc("Бузулук — Из-за леса, из-за гор"),
    title: "Бузулук — Из-за леса, из-за гор",
    caption: "2:45",
    vkType: 105,
    vkMode: 0,
    vkGroupRole: "first",
  },
  {
    id: "por-buzuluk-audio-2",
    type: "audio",
    src: resolvePorushkaAudioSrc("Казачий хор станицы Усть-Бузулукской — Из-за леса, из-за гор"),
    title: "Казачий хор станицы Усть-Бузулукской — Из-за леса, из-за гор",
    caption: "2:37",
    vkType: 105,
    vkMode: 0,
    vkGroupRole: "middle",
  },
  {
    id: "por-buzuluk-audio-3",
    type: "audio",
    src: resolvePorushkaAudioSrc("Казачьи плясовые — Из-за леса из-за гор"),
    title: "Казачьи плясовые — Из-за леса из-за гор",
    caption: "1:00",
    vkType: 105,
    vkMode: 0,
    vkGroupRole: "last",
  },
  {
    id: "por-buzuluk-quote-main",
    type: "quote",
    text:
      "Из-за леса из-за гор выходила туча-гром\nПараня, Параня, Паранюшка моя\n\nВыходила туча-гром со усиленным дождём\nПосле сильного дождя была улица грязна\nБыла улица грязна, нельзя молодцу пройти\nНельзя молодцу пройти и к Паране подойти\nУ Параниных ворот стоит озеро воды\nСтоит озеро воды по колено глубины\nКак во этом во болоте молодец коня поил\nМолодец коня поил и с Параней говорил\nТы, Паранюшка моя, подержи мово коня\nЯ когда была твоя, я держала коня\nА теперь я не твоя, не могу держать коня",
    author: "ст. Усть-Бузулукская Алексеевского р-на Волгоградской области",
  },
  {
    id: "por-vyatka-intro",
    type: "text",
    html: "<p>В Вятской губернии в 1894 году мОлодец был щеголем с деньгами —</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-vyatka-quote",
    type: "quote",
    text:
      "Подымалась туча-гром\n<...>\nПройти молодцу нельзя.\nЯ пешком-то не пойду;\nЯ извощика найму;\nИзвощика — играча,\nОхотничка — скрипача.\nЯ не сяду с тобой рядом,\nЯ сердита на тебя!\nЗа вчерашнюю обиду\nДружку выпеняю,\nВ глаза выругаю…\nЯ за то тебя люблю:\nЗа паходочку часту,\nЗа одежду щегольску.",
  },
  {
    id: "por-vanya-transition",
    type: "text",
    html:
      "<p>Здесь же, деревенские зарисовки про Ванюшу переходят в любовные терзания, ухаживания, описания незаконного проникновения в жилище к возлюбленной и окончании любви.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-marena-intro-quote",
    type: "quote",
    text: "«Пошли девки марену копать…»",
  },
  {
    id: "por-marena-quote",
    type: "quote",
    text:
      "Пошли девки марену копать,\nНакопамши запотели\nИ есть захотели и купаться захотели;\nКупаться не купаться — белым мылом умываться.\nГде ни взялся вор Ванюша,\nОн покрал у них рубашки\nТонки белыя, альняныя.\nОдна девка маленька да смышленинька\nЗа Ванюшей увязалася:\n— Ты подай, Ванька, рубашки тонки (и проч.)\nТы, Ванюша, побожися,\nК иконе приложися!\n— Ты бей меня ни колом,\nОб обмет, об солому.\n\nБелая моя, белотелая,\nНе ты ль меня, лапушка, высушила.\nБез морозу лютого\nСердце иззнобила.\nКак рассыпалась печаль\nПо моим ясным очам,\nРассыпалась сухота\nПо моему животу.\nКак заставила сударушка\nВдоль улицы ходить,\nГостиньчики носить,\nПряники, орешки коленые,\nСмоквы привезеные,\nУж к тебе, касатушка,\nНи один разик приходил,\nТрое котиков (башмаков) избил,\nИзодрал я синь кафтан\nПо заборам, по плетням,\nИзорвал я перчаточки,\nЗа колья хватаючи.\nИспортил я шляпочку\nПод капелыо стоючи.\nКапелюшка капала,\nПо нас девки плакали,\nКапелюшка перестала,\nЛюбить девушку не стали.",
  },
  {
    id: "por-marena-source",
    type: "quote",
    text: "№594 Собрание Киреевского. Записано в Лубянске Ряжского уезда Рязанской губернии.",
  },
  {
    id: "por-adult-variants",
    type: "text",
    html: "<h3>Более неприличные варианты</h3><p>Сюжет из Курской области о неравном браке и разлуке.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-adult-variants-quote",
    type: "quote",
    text:
      "Уж ты, верная, манерная, сударушка моя,\nТы меня, сударушка, высушила,\n<...>\nПриневолила любить чужемужнюю жену!\n<...> (Начало как в «Порушке»)\nЯ баяла, манула\nК себе милаго дружка:\nПерейди, друг, перейди\nНа мою сторону! —\n— Уж я рад бы перешел, —\nПереходу не нашел!\nПереходушки часты —\nВсе калиновы мосты.\nУж мне по мосту пройтить, —\nМостовую заплатить;\nЧерез плотинушку пройтить, —\nПолтинушку заплатить;\nЧерез тихий Дон поплыть, —\nЗелен кафтан намочить,\nСветлое платье помарать,\nУ сударушки не бывать,\nУ глазушках не видать.\nКак ее можно\nСтараго мужа обмануть?\nСкажу: дождик приходил,\nСкажу: дробненький;\nПод ракитою стояла,\nДробнаго дождю пережидала.\nС милым дружком простояла —\nНабалакалась и наплакалась!",
    author: "Курская губерния, Щигровский уезд. Халанский, № 32.",
  },
  {
    id: "por-dunya-heading",
    type: "text",
    html:
      "<h3>Неприличный сюжеты в которых парень добивается девушки — «покупает любовь»</h3><p>Он дарит ей подарочки, приглашает в гости, иногда усыпает комплиментами и обещаниями. Итог — дурная слава. Про эту девушку теперь поёт всё село — «Дунюшка».</p>",
    align: "left",
    fontScale: "md",
  },
  ...PORUSHKA_DUNYA_AUDIO.map((item, idx) => ({
    id: `por-dunya-audio-${idx + 1}`,
    type: "audio" as const,
    src: resolvePorushkaAudioSrc(item.title),
    title: item.title,
    caption: item.caption,
    vkType: 105 as const,
    vkMode: 0 as const,
    vkGroupRole: vkGroupRoleAt(idx, PORUSHKA_DUNYA_AUDIO.length),
  })),
  {
    id: "por-dunya-quote-main",
    type: "quote",
    text:
      "Шёл я улком, переулком,\nВо зелёный сад гулять,\nУговаривал Ванюша\nК себе Дуню ночевать.\nУговаривал Ванюша\nК себе Дуню ночевать,\nЗаночуй-ка Дунюшка,\nЗаночуй голубушка.\nПодарю радость такую, ты сама знаешь какую:\nВ одно ушечко серёжачку серебрянаю,\nА в другую – золатую, с поднавесочками,\nС поднавесочками, с тремя звездачками.\nСогласилася Дуняша на Ванюшины слова.\nОна долго не спала, много во сне видела,\nКак Иванушка по горенки похаживает,\nСвои белые подштаники развязывает,\nСвоё белое перо, вынимает наголо.\nСтал в чернильницу макать, стала Дунюшка кричать.\n«Постой, Дуня, не кричи, раз дала, теперь молчи,\nВсё сотрётся, все сомнётся, всё по старому пойдёт,\nВсё по старому пойдёт, фарья жиром зарастёт».",
    author: "ст. Старопавловская Ставропольский край, но этот сюжет широко распространён и на Дону",
  },
  {
    id: "por-dunya-text",
    type: "text",
    html:
      "<p>Окончание от Вятских переселенцев пос. Куженер Куженерского р-на марийской асср.</p><p>Тот же сюжет но в северно-русском стиле. Ничего лишнего вообще не говорится.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-dunya-quote-kuzhener",
    type: "quote",
    text:
      "Начало перо писать, стала Дунюша кричать,\nНе кричи-ка, Дунюшка, да потерпи, голубушка.\nКогда це***ку ломают, Завсегда больно бывает.",
  },
  {
    id: "por-dunya-quote-north",
    type: "quote",
    text:
      "Подговаривал Иван\nК себе Дуню ночевать:\n«Ты ночуй, ночуй, Дуняша,\nПогости, голубушка!\nТы ночуешь и учуешь....\nПодарю, Дуня, тебе,\nПодарю Дуне сережки\nСеребряныя,\nЯ вторыя — золотыя\nСо подвесочками!»\nНа то Дуня соглашалась,\nНочевать с Ваней осталась.\nЛожилася Дуня спать\nНа Иванову кровать.\nДуне мало спалось,\nМного во снях виделось;\nПривиделся Дуне сон:\nМой-ет миленький идет,\nМой-ет миленький идет,\nКак ясен сокол летит;\nС горенки во горенку похаживает,\nОн сапог о сапог поколачивает,\nОн к Дуняшиной кровати приворачивает,\nИз окошка в окошко посматривает,\nКоленкоровы завески раздергивает.\nНе будите молоду рано-рано по утру,\nРазбудите молоду, когда солнышко взойдет....",
    author: "Архангельская губерния, Мезенский уезд. Якушкин, стр. 608.",
  },
  {
    id: "por-about-girls",
    type: "text",
    html:
      "<h3>О девушках</h3><p>Как вы могли заметить, сюжеты про «Порушку», «Сударушку» в основном про любовь или же несбывшуюся любовь. Персонажи страдают, осмысливают происходящее, проговаривают, вспоминают прошлое, а певец проживает и выпускает боль, личные переживания. Поётся о нормах общества и нравственном выборе. В нашем случае, это часто карагодные песни.</p><p>В сюжетах про «Дуняшу» текст обычно более интимный и даже пошлый. Это и назидание молодым девушкам и влияние мужского или взрослого, замужнего фольклора. Подобных песен хватает — в основном это шуточные, плясовые или песни второго свадебного дня. Их пели уже замужние и женатые люди.</p><p>В одной и той же традиции встречаются песни с упоминанием и разных имен, и одних и тех же имен но с разными вариациями. Два этих «больших» сюжета местами связанны, но всё-таки поют о разном.</p><h3>И как мы поняли, песня «Порушка-Параня» — о любви</h3><p>Всеми любимый сюжет из села Афанасьевка имеет законченный вид.<br/>Оттого и предлагаю вам эту песню выучить.</p><p>Мой разбор схемы — основы этой песни.</p><p>В аудиозаписи №03 — Основной голос — песня спета целиком — все 34 куплета.</p>",
    align: "left",
    fontScale: "md",
  },
  ...PORUSHKA_LEARN_AUDIO.map((item, idx) => ({
    id: `por-learn-audio-${idx + 1}`,
    type: "audio" as const,
    src: resolvePorushkaAudioSrc(item.title),
    title: item.title,
    caption: item.caption,
    vkType: 105 as const,
    vkMode: 0 as const,
    vkGroupRole: vkGroupRoleAt(idx, PORUSHKA_LEARN_AUDIO.length),
  })),
  {
    id: "por-outro",
    type: "text",
    html:
      "<p>Буду рад вашей поддержке. Если материал кажется полезным — распространяйте его. Если есть что добавить — пишите и присылайте варианты. Пусть народная песня вернётся к людям.</p><p><strong>Ниже плейлист целиком:</strong> в каталоге более 30 аудиозаписей.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "por-playlist",
    type: "playlist",
    title: "Порушка-Параня — плейлист на сайте",
    vkType: 100,
    vkMode: 0,
    vkGroupRole: "single",
    songSlugs: [
      "selezen",
      "balman-ty-zorya-moya",
      "balman-seyu-veyu",
      "balman-lipynka",
      "balman-kumushki-skachite",
      "balman-vechor-devku",
      "balman-ya-kachu-kolco",
      "talbakul-poteryala-ya-kolechko",
      "tomsk-bogoslovka-po-moryam",
    ],
  },
];

const kurskieBlocks: ArticleBlock[] = [
  {
    id: "kurskie-intro",
    type: "text",
    html:
      "<h2>Курские песни</h2><p><em>Миграционный слот canonical #2.</em></p><p>Эта страница фиксирует маршрут для дальнейшего поэтапного переноса материала из VK в внутренний рендерер статьи. Контент ниже задает стартовую структуру для визуальной и функциональной паритетной доработки.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "kurskie-focus",
    type: "ordered_list",
    items: [
      "Проверить визуальный паритет заголовков и группировок блоков.",
      "Уточнить медиа-блоки и атрибуты источников.",
      "Закрыть open-пункты phase-0 delta с фиксацией в снапшотах.",
    ],
    start: 1,
  },
];

const vasyaBlocks: ArticleBlock[] = [
  {
    id: "vasya-intro",
    type: "text",
    html:
      "<h2>Вася-Василёчек: история одной народной песни</h2><p><em>Миграционный слот canonical #3.</em></p><p>Маршрут открыт для внутреннего рендера и SEO-индексации. Страница предназначена для поэтапного доведения визуального паритета по данным capture-паков и phase-0 delta-логов.</p>",
    align: "left",
    fontScale: "md",
  },
  {
    id: "vasya-quote",
    type: "quote",
    text: "Сначала фиксируем стабильный runtime-route, затем доводим полный визуальный паритет по артефактам.",
    author: "migration note",
  },
];

export const ARTICLES: ArticleItem[] = [
  {
    slug: "oi-ty-porushka-paranya",
    title: "Ой, ты Порушка-Параня",
    subtitle: "Введение, архивные аудио/видео, разбор сюжета и материалы для изучения",
    titleTranslations: {
      ru: "Ой, ты Порушка-Параня",
      en: "Oh You, Porushka-Paranya",
    },
    subtitleTranslations: {
      ru: "Введение, архивные аудио/видео, разбор сюжета и материалы для изучения",
      en: "Introduction, archival audio/video, story analysis, and study materials",
    },
    sourceLabel: "Исходник: VK",
    sourceUrl: "https://vk.com/@bagrintsev_folk-oi-ty-porushka-paranya",
    publishedAt: "2026-02-20",
    sections: [],
    blocks: porushkaBlocks,
  },
  {
    slug: "kurskie-pesni-avtor-russkii-narod",
    title: "Курские песни (автор: русский народ)",
    subtitle: "Canonical #2: runtime-маршрут для поэтапной parity-миграции",
    titleTranslations: {
      ru: "Курские песни (автор: русский народ)",
      en: "Kursk Songs (author: Russian folk tradition)",
    },
    subtitleTranslations: {
      ru: "Canonical #2: runtime-маршрут для поэтапной parity-миграции",
      en: "Canonical #2: runtime route for staged parity migration",
    },
    sourceLabel: "Исходник: VK",
    sourceUrl: "https://vk.com/@bagrintsev_folk-kurskie-pesni-avtor-russkii-narod",
    publishedAt: "2026-02-22",
    sections: [],
    blocks: kurskieBlocks,
  },
  {
    slug: "vasya-vasilechek-istoriya-odnoi-narodnoi-pesni",
    title: "Вася-Василёчек: история одной народной песни",
    subtitle: "Canonical #3: runtime-маршрут для поэтапной parity-миграции",
    titleTranslations: {
      ru: "Вася-Василёчек: история одной народной песни",
      en: "Vasya-Vasilechek: Story of a Folk Song",
    },
    subtitleTranslations: {
      ru: "Canonical #3: runtime-маршрут для поэтапной parity-миграции",
      en: "Canonical #3: runtime route for staged parity migration",
    },
    sourceLabel: "Исходник: VK",
    sourceUrl: "https://vk.com/@bagrintsev_folk-vasya-vasilechek-istoriya-odnoi-narodnoi-pesni",
    publishedAt: "2026-02-22",
    sections: [],
    blocks: vasyaBlocks,
  },
];

export function getArticleTitle(article: ArticleItem, locale: Locale): string {
  return article.titleTranslations?.[locale] ?? article.titleTranslations?.ru ?? article.title;
}

export function getArticleSubtitle(article: ArticleItem, locale: Locale): string {
  return article.subtitleTranslations?.[locale] ?? article.subtitleTranslations?.ru ?? article.subtitle;
}

export function getArticleBySlug(slug: string): ArticleItem | undefined {
  const normalized = decodeURIComponent(slug).trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  return ARTICLES.find((item) => item.slug.toLowerCase() === normalized);
}

export function estimateArticleReadMinutes(article: ArticleItem): number {
  const textFromBlocks = (article.blocks ?? [])
    .map((block) => {
      if (block.type === "text") return block.html.replace(/<[^>]+>/g, " ");
      if (block.type === "quote") return block.text;
      if (block.type === "ordered_list") return block.items.join(" ");
      if (block.type === "table") return block.rows.flat().join(" ");
      return "";
    })
    .join(" ");

  const textFromSections = article.sections
    .flatMap((section) => [section.heading ?? "", ...section.paragraphs])
    .join(" ");

  const allText = `${textFromBlocks} ${textFromSections}`.trim();
  if (!allText) return 1;
  const words = allText.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 180));
}
