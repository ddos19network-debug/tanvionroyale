import type {
  ProviderCompetition,
  ProviderEvent,
  ProviderOdd,
  ProviderSport,
} from '../interfaces';

/**
 * Static in-memory fixture data for the mock operator.
 *
 * WARNING: Development fixtures only. These are NOT a real live sports feed.
 * The catalog demonstrates the sports-hub UI (Football, Cricket, Basketball,
 * Tennis), multiple competitions (IPL, BPL, PSL, Premier League, Champions
 * League, ...) and LIVE/UPCOMING events. Real licensed providers must supply
 * their own data behind the same OperatorProviderInterface.
 */
export function buildMockCatalog(): {
  sports: ProviderSport[];
  events: ProviderEvent[];
  odds: ProviderOdd[];
} {
  const providerId = 'mock-operator';

  const football: ProviderSport = {
    externalProvider: providerId,
    externalId: 'sport-football',
    name: 'Football',
    active: true,
  };
  const basketball: ProviderSport = {
    externalProvider: providerId,
    externalId: 'sport-basketball',
    name: 'Basketball',
    active: true,
  };
  const tennis: ProviderSport = {
    externalProvider: providerId,
    externalId: 'sport-tennis',
    name: 'Tennis',
    active: true,
  };
  const cricket: ProviderSport = {
    externalProvider: providerId,
    externalId: 'sport-cricket',
    name: 'Cricket',
    active: true,
  };

  // -------------------------------------------------------------------------
  // Competitions (development fixtures only)
  // -------------------------------------------------------------------------
  const premierLeague: ProviderCompetition = {
    externalProvider: providerId,
    externalId: 'comp-epl',
    sport: football,
    name: 'Premier League',
    country: 'England',
  };
  const championsLeague: ProviderCompetition = {
    externalProvider: providerId,
    externalId: 'comp-ucl',
    sport: football,
    name: 'Champions League',
    country: 'Europe',
  };
  const ipl: ProviderCompetition = {
    externalProvider: providerId,
    externalId: 'comp-ipl',
    sport: cricket,
    name: 'IPL',
    country: 'India',
  };
  const bpl: ProviderCompetition = {
    externalProvider: providerId,
    externalId: 'comp-bpl',
    sport: cricket,
    name: 'BPL',
    country: 'Bangladesh',
  };
  const psl: ProviderCompetition = {
    externalProvider: providerId,
    externalId: 'comp-psl',
    sport: cricket,
    name: 'PSL',
    country: 'Pakistan',
  };
  const nba: ProviderCompetition = {
    externalProvider: providerId,
    externalId: 'comp-nba',
    sport: basketball,
    name: 'NBA',
    country: 'USA',
  };
  const atp: ProviderCompetition = {
    externalProvider: providerId,
    externalId: 'comp-atp',
    sport: tennis,
    name: 'ATP Tour',
    country: 'International',
  };

  const now = Date.now();
  const hour = 3_600_000;
  const day = 86_400_000;

  // -------------------------------------------------------------------------
  // Events (development fixtures only — clearly fake, not a real live feed)
  // -------------------------------------------------------------------------
  const events: ProviderEvent[] = [
    // Football — Premier League
    {
      externalProvider: providerId,
      externalId: 'evt-1001',
      competition: premierLeague,
      kicksOffAt: new Date(now + day).toISOString(),
      homeName: 'Alpha United',
      awayName: 'Beta City',
      status: 'UPCOMING',
      live: false,
    },
    {
      externalProvider: providerId,
      externalId: 'evt-1002',
      competition: premierLeague,
      kicksOffAt: new Date(now + hour).toISOString(),
      homeName: 'Gamma Rovers',
      awayName: 'Delta FC',
      status: 'LIVE',
      live: true,
    },
    // Football — Champions League
    {
      externalProvider: providerId,
      externalId: 'evt-1003',
      competition: championsLeague,
      kicksOffAt: new Date(now + 2 * day).toISOString(),
      homeName: 'Epsilon Madrid',
      awayName: 'Zeta Munich',
      status: 'UPCOMING',
      live: false,
    },
    {
      externalProvider: providerId,
      externalId: 'evt-1004',
      competition: championsLeague,
      kicksOffAt: new Date(now + 2 * hour).toISOString(),
      homeName: 'Eta City',
      awayName: 'Theta Milan',
      status: 'LIVE',
      live: true,
    },
    // Cricket — IPL
    {
      externalProvider: providerId,
      externalId: 'evt-2001',
      competition: ipl,
      kicksOffAt: new Date(now + 3 * hour).toISOString(),
      homeName: 'Mumbai Indians',
      awayName: 'Chennai Super Kings',
      status: 'LIVE',
      live: true,
    },
    {
      externalProvider: providerId,
      externalId: 'evt-2002',
      competition: ipl,
      kicksOffAt: new Date(now + 2 * day).toISOString(),
      homeName: 'Royal Challengers Bengaluru',
      awayName: 'Kolkata Knight Riders',
      status: 'UPCOMING',
      live: false,
    },
    // Cricket — BPL
    {
      externalProvider: providerId,
      externalId: 'evt-2003',
      competition: bpl,
      kicksOffAt: new Date(now + 5 * hour).toISOString(),
      homeName: 'Dhaka Dominators',
      awayName: 'Chattogram Challengers',
      status: 'LIVE',
      live: true,
    },
    {
      externalProvider: providerId,
      externalId: 'evt-2004',
      competition: bpl,
      kicksOffAt: new Date(now + 3 * day).toISOString(),
      homeName: 'Sylhet Strikers',
      awayName: 'Khulna Tigers',
      status: 'UPCOMING',
      live: false,
    },
    // Cricket — PSL
    {
      externalProvider: providerId,
      externalId: 'evt-2005',
      competition: psl,
      kicksOffAt: new Date(now + 6 * hour).toISOString(),
      homeName: 'Lahore Qalandars',
      awayName: 'Karachi Kings',
      status: 'LIVE',
      live: true,
    },
    {
      externalProvider: providerId,
      externalId: 'evt-2006',
      competition: psl,
      kicksOffAt: new Date(now + 4 * day).toISOString(),
      homeName: 'Islamabad United',
      awayName: 'Peshawar Zalmi',
      status: 'UPCOMING',
      live: false,
    },
    // Basketball — NBA
    {
      externalProvider: providerId,
      externalId: 'evt-3001',
      competition: nba,
      kicksOffAt: new Date(now + 4 * hour).toISOString(),
      homeName: 'Lakers',
      awayName: 'Celtics',
      status: 'LIVE',
      live: true,
    },
    {
      externalProvider: providerId,
      externalId: 'evt-3002',
      competition: nba,
      kicksOffAt: new Date(now + 5 * day).toISOString(),
      homeName: 'Warriors',
      awayName: 'Bucks',
      status: 'UPCOMING',
      live: false,
    },
    // Tennis — ATP Tour
    {
      externalProvider: providerId,
      externalId: 'evt-4001',
      competition: atp,
      kicksOffAt: new Date(now + 7 * hour).toISOString(),
      homeName: 'Player One',
      awayName: 'Player Two',
      status: 'LIVE',
      live: true,
    },
    {
      externalProvider: providerId,
      externalId: 'evt-4002',
      competition: atp,
      kicksOffAt: new Date(now + 6 * day).toISOString(),
      homeName: 'Player Three',
      awayName: 'Player Four',
      status: 'UPCOMING',
      live: false,
    },
    // Premier League — SUSPENDED (bettable again only after the provider reopens)
    {
      externalProvider: providerId,
      externalId: 'evt-sus-1',
      competition: premierLeague,
      kicksOffAt: new Date(now + 12 * hour).toISOString(),
      homeName: 'Suspended Strikers',
      awayName: 'Derby Rebound',
      status: 'SUSPENDED',
      live: false,
    },
    // Champions League — FINISHED (results only; never bettable)
    {
      externalProvider: providerId,
      externalId: 'evt-fin-1',
      competition: championsLeague,
      kicksOffAt: new Date(now - 2 * day).toISOString(),
      homeName: 'Finished Classic',
      awayName: 'Past Winners',
      status: 'FINISHED',
      live: false,
    },
  ];

  const mkOdd = (eventId: string, externalId: string, name: string, decimal: string): ProviderOdd => ({
    externalProvider: providerId,
    externalId: `${eventId}-${externalId}`,
    selection: {
      externalProvider: providerId,
      externalId: `${eventId}-${externalId}`,
      market: {
        externalProvider: providerId,
        externalId: `${eventId}-market-winner`,
        event: events.find((e) => e.externalId === eventId)!,
        name: 'Match Winner',
      },
      name,
    },
    decimal,
    status: 'OPEN',
    updatedAt: new Date().toISOString(),
  });

  const odds: ProviderOdd[] = [
    // Football — Premier League
    mkOdd('evt-1001', 'sel-home', 'Home', '1.85'),
    mkOdd('evt-1001', 'sel-draw', 'Draw', '3.40'),
    mkOdd('evt-1001', 'sel-away', 'Away', '4.20'),
    mkOdd('evt-1002', 'sel-home', 'Home', '2.10'),
    mkOdd('evt-1002', 'sel-draw', 'Draw', '3.20'),
    mkOdd('evt-1002', 'sel-away', 'Away', '3.55'),
    // Football — Champions League
    mkOdd('evt-1003', 'sel-home', 'Home', '1.70'),
    mkOdd('evt-1003', 'sel-draw', 'Draw', '3.60'),
    mkOdd('evt-1003', 'sel-away', 'Away', '4.80'),
    mkOdd('evt-1004', 'sel-home', 'Home', '2.25'),
    mkOdd('evt-1004', 'sel-draw', 'Draw', '3.10'),
    mkOdd('evt-1004', 'sel-away', 'Away', '3.30'),
    // Cricket — IPL
    mkOdd('evt-2001', 'sel-home', 'Mumbai Indians', '1.90'),
    mkOdd('evt-2001', 'sel-away', 'Chennai Super Kings', '1.90'),
    mkOdd('evt-2002', 'sel-home', 'Royal Challengers Bengaluru', '1.75'),
    mkOdd('evt-2002', 'sel-away', 'Kolkata Knight Riders', '2.05'),
    // Cricket — BPL
    mkOdd('evt-2003', 'sel-home', 'Dhaka Dominators', '1.80'),
    mkOdd('evt-2003', 'sel-away', 'Chattogram Challengers', '2.00'),
    mkOdd('evt-2004', 'sel-home', 'Sylhet Strikers', '2.10'),
    mkOdd('evt-2004', 'sel-away', 'Khulna Tigers', '1.70'),
    // Cricket — PSL
    mkOdd('evt-2005', 'sel-home', 'Lahore Qalandars', '1.85'),
    mkOdd('evt-2005', 'sel-away', 'Karachi Kings', '1.95'),
    mkOdd('evt-2006', 'sel-home', 'Islamabad United', '2.00'),
    mkOdd('evt-2006', 'sel-away', 'Peshawar Zalmi', '1.80'),
    // Basketball — NBA
    mkOdd('evt-3001', 'sel-home', 'Lakers', '1.60'),
    mkOdd('evt-3001', 'sel-away', 'Celtics', '2.30'),
    mkOdd('evt-3002', 'sel-home', 'Warriors', '1.90'),
    mkOdd('evt-3002', 'sel-away', 'Bucks', '1.90'),
    // Tennis — ATP Tour
    mkOdd('evt-4001', 'sel-home', 'Player One', '1.65'),
    mkOdd('evt-4001', 'sel-away', 'Player Two', '2.20'),
    mkOdd('evt-4002', 'sel-home', 'Player Three', '2.00'),
    mkOdd('evt-4002', 'sel-away', 'Player Four', '1.80'),
    // Premier League — Suspended (play reopens when the provider reopens)
    mkOdd('evt-sus-1', 'sel-over', 'Over 2.5', '1.95'),
    mkOdd('evt-sus-1', 'sel-under', 'Under 2.5', '1.85'),
    // Champions League — Finished (display only)
    mkOdd('evt-fin-1', 'sel-home', 'Home', '1.50'),
    mkOdd('evt-fin-1', 'sel-away', 'Away', '2.60'),
  ];

  return { sports: [football, basketball, tennis, cricket], events, odds };
}