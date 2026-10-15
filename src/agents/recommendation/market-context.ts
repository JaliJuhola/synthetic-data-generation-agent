import { z } from 'zod';

const dateSchema = z.iso.date();
const marketContextSchema = z.object({
  kind: z.literal('mock-market-context'),
  historicalMeasurement: z.literal(false),
  date: dateSchema,
  country: z.string().length(2),
  season: z.enum(['spring', 'summer', 'autumn', 'winter']),
  weather: z.string().min(1),
  holidays: z.array(z.string()),
  shoppingPeriods: z.array(z.string()),
  fictionalTrends: z.array(z.string()),
});

function seasonFor(date: string): 'spring' | 'summer' | 'autumn' | 'winter' {
  const month = Number(date.slice(5, 7));
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export function createMockMarketContext(date: string, country: string) {
  const parsedDate = dateSchema.safeParse(date);
  if (!parsedDate.success || !/^[A-Z]{2}$/.test(country)) throw new RangeError('Market context requires an ISO date and uppercase two-letter country code.');
  const season = seasonFor(date);
  const weatherBySeason = {
    spring: 'Fictional mild, changeable weather with occasional rain.',
    summer: 'Fictional warm, mostly dry weather with bright afternoons.',
    autumn: 'Fictional cool, breezy weather with intermittent showers.',
    winter: 'Fictional cold-season weather with shorter daylight hours.',
  };
  const calendarContext: Record<string, { holidays: string[]; shoppingPeriods: string[] }> = {
    US: { holidays: ['Fictional Community Makers Day'], shoppingPeriods: ['Fictional Early Summer Home Refresh'] },
    CA: { holidays: ['Fictional Northern Lights Day'], shoppingPeriods: ['Fictional Outdoor Season Preview'] },
    GB: { holidays: ['Fictional Green Market Weekend'], shoppingPeriods: ['Fictional Autumn Reading Period'] },
    AU: { holidays: ['Fictional Southern Coast Day'], shoppingPeriods: ['Fictional Spring Gear Week'] },
  };
  const localCalendar = calendarContext[country] ?? {
    holidays: ['Fictional Local Makers Day'],
    shoppingPeriods: ['Fictional Seasonal Discovery Period'],
  };
  return marketContextSchema.parse({
    kind: 'mock-market-context',
    historicalMeasurement: false,
    date,
    country,
    season,
    weather: weatherBySeason[season],
    ...localCalendar,
    fictionalTrends: [
      `Fictional ${season} interest in practical ${season === 'winter' ? 'indoor' : 'outdoor'} routines.`,
      'Fictional shoppers comparing product durability and everyday versatility.',
    ],
  });
}