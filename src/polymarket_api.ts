import axios from 'axios';

export interface Market {
  question: string;
  outcomePrices: number[];
  endDate?: string;
}

const POLY_API = process.env.POLYMARKET_API || "https://api.polymarket.com";

export async function getMarkets(limit: number = 10): Promise<Market[]> {
  try {
    const url = `${POLY_API}/markets?limit=${limit}`;
    const response = await axios.get(url);
    const data = response.data;

    return data.map((item: any) => ({
      question: item.question || "",
      outcomePrices: item.outcomePrices || [],
      endDate: item.endDate,
    }));
  } catch (error) {
    console.error("Error fetching markets:", error);
    throw error;
  }
}

