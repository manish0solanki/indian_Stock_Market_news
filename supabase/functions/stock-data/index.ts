// stock-data: on-demand quote, Yahoo fundamentals and daily history for one NSE stock.
// GET ?symbol=TCS[&days=400]  days = how much daily history to return (14 by default, up to 400).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    let symbol = url.searchParams.get("symbol")?.trim().toUpperCase();

    if (!symbol) {
      return json(
        { success: false, error: "Missing symbol", example: "?symbol=TCS" },
        400
      );
    }

    symbol = symbol.replace(".NS", "").replace(".NSE", "");

    if (!/^[A-Z0-9&.-]+$/.test(symbol)) {
      return json({ success: false, error: "Invalid stock symbol" }, 400);
    }

    const yahooSymbol = `${symbol}.NS`;

    // Daily history window: 14 days unless the caller asks for more (the stock search card asks for ~1 year).
    const historyDays = Math.min(400, Math.max(14, Math.floor(Number(url.searchParams.get("days")) || 14)));

    // ========================================================
    // HELPERS
    // ========================================================

    function raw(value: any): number | null {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value === "object" && value !== null && "raw" in value) {
        const n = Number(value.raw);
        return Number.isFinite(n) ? n : null;
      }

      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }

    function yahooCookieFromResponse(response: Response): string {
      // Deno may expose combined set-cookie values.
      const headers = response.headers;
      const setCookie = headers.get("set-cookie") || "";
      return setCookie;
    }

    function extractCookie(setCookie: string): string {
      if (!setCookie) {
        return "";
      }

      // We mainly need A3, but preserve other Yahoo cookies too.
      const matches = setCookie.match(/(?:^|,\s*)([A-Za-z0-9_-]+)=[^;,]+/g);

      if (!matches) {
        return "";
      }

      return matches
        .map((item) => item.replace(/^,\s*/, "").split(";")[0])
        .join("; ");
    }

    // ========================================================
    // 1. YAHOO CHART DATA
    // ========================================================

    // Use explicit rolling timestamps instead of Yahoo's named range.
    // This avoids stale/cached 1mo responses and makes the window advance every request.
    const nowMs = Date.now();
    const period2 = Math.floor((nowMs + 24 * 60 * 60 * 1000) / 1000);
    const period1 = Math.floor((nowMs - historyDays * 24 * 60 * 60 * 1000) / 1000);
    const cacheBust = nowMs.toString();

    const chartUrl =
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(yahooSymbol) +
      "?interval=1d" +
      "&period1=" + period1 +
      "&period2=" + period2 +
      "&events=div%2Csplits" +
      "&includePrePost=false" +
      "&cacheBust=" + cacheBust;

    const chartResponse = await fetch(chartUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
    });

    if (!chartResponse.ok) {
      return json(
        {
          success: false,
          error: `Yahoo chart returned HTTP ${chartResponse.status}`,
          symbol,
        },
        502
      );
    }

    const chartData = await chartResponse.json();

    const result = chartData?.chart?.result?.[0];

    if (!result) {
      return json({ success: false, error: "Stock not found", symbol }, 404);
    }

    const meta = result.meta || {};

    const quote = result.indicators?.quote?.[0] || {};

    const timestamps = result.timestamp || [];

    const closes = quote.close || [];

    // ========================================================
    // 2. PRICE + CANDLE-BASED PREVIOUS CLOSE (fallback only)
    //    Anchor on the live snapshot's session date (IST). Yahoo's
    //    daily series can miss whole sessions, so the final previous
    //    close prefers Yahoo's own quote value (see section 6b).
    // ========================================================

    const istDate = (sec: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(sec * 1000));

    const nowSeconds = Math.floor(Date.now() / 1000);
    const todayIST = istDate(nowSeconds);
    const [hh, mm] = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date())
      .split(":")
      .map(Number);
    const beforeOpen = hh * 60 + mm < 9 * 60 + 15;

    // One candle per IST date, ascending
    const byDate = new Map<string, number>();
    for (let i = 0; i < closes.length; i++) {
      const ts = Number(timestamps[i]);
      const c = closes[i];
      if (!Number.isFinite(ts) || ts > nowSeconds) continue;
      if (c === null || c === undefined || !Number.isFinite(Number(c))) continue;
      const d = istDate(ts);
      if (d === todayIST && beforeOpen) continue; // pre-open "today" bar is not a session
      byDate.set(d, i); // later bar for the same date wins
    }
    const bars = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

    const metaPrice = raw(meta.regularMarketPrice);
    const metaMarketTime = Number(meta.regularMarketTime);

    // Live snapshot usable? (valid price, timestamp not in the future, not stale)
    const metaIsUsable =
      metaPrice !== null &&
      metaPrice > 0 &&
      Number.isFinite(metaMarketTime) &&
      metaMarketTime > 0 &&
      metaMarketTime <= nowSeconds &&
      nowSeconds - metaMarketTime <= 10 * 24 * 60 * 60;

    const lastBar = bars.length ? bars[bars.length - 1] : null;

    // Session we are reporting on
    const sessionDate: string | null = metaIsUsable
      ? istDate(metaMarketTime)
      : lastBar
      ? lastBar[0]
      : null;

    // Candle for the reporting session (if Yahoo's series has it) -> OHLCV
    const sessionBar = sessionDate ? bars.find(([d]) => d === sessionDate) : null;
    const latestIndex = sessionBar ? sessionBar[1] : -1;

    // Candle-based previous close = last candle strictly before the session date
    const prevBar = sessionDate
      ? [...bars].reverse().find(([d]) => d < sessionDate)
      : null;
    const previousIndex = prevBar ? prevBar[1] : -1;

    const price = metaIsUsable
      ? metaPrice
      : lastBar
      ? Number(closes[lastBar[1]])
      : null;
    const candlePrevClose = previousIndex >= 0 ? Number(closes[previousIndex]) : null;

    // ========================================================
    // 3. BOOTSTRAP YAHOO COOKIE
    // ========================================================

    let cookie = "";
    let crumb = "";

    try {
      const cookieResponse = await fetch("https://fc.yahoo.com/", {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "*/*",
        },
      });

      cookie = yahooCookieFromResponse(cookieResponse);
      cookie = extractCookie(cookie);
    } catch (error) {
      console.log("Yahoo cookie bootstrap failed:", error);
    }

    // ========================================================
    // 4. GET YAHOO CRUMB
    // ========================================================

    if (cookie) {
      try {
        const crumbResponse = await fetch(
          "https://query1.finance.yahoo.com/v1/test/getcrumb",
          {
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0",
              "Accept": "text/plain",
              "Cookie": cookie,
            },
          }
        );

        if (crumbResponse.ok) {
          const crumbText = (await crumbResponse.text()).trim();

          if (crumbText && !crumbText.includes("<html")) {
            crumb = crumbText;
          }
        }
      } catch (error) {
        console.log("Yahoo crumb request failed:", error);
      }
    }

    // ========================================================
    // 5. GET FUNDAMENTALS
    // ========================================================

    let fundamentals: any = null;

    if (crumb && cookie) {
      try {
        const modules = [
          "price",
          "summaryDetail",
          "defaultKeyStatistics",
          "financialData",
          "assetProfile",
        ].join(",");

        const fundamentalsUrl =
          "https://query2.finance.yahoo.com/v10/finance/quoteSummary/" +
          encodeURIComponent(yahooSymbol) +
          "?modules=" +
          encodeURIComponent(modules) +
          "&crumb=" +
          encodeURIComponent(crumb);

        const fundamentalsResponse = await fetch(fundamentalsUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
            "Cookie": cookie,
          },
        });

        if (fundamentalsResponse.ok) {
          const fundamentalsJson = await fundamentalsResponse.json();

          fundamentals = fundamentalsJson?.quoteSummary?.result?.[0] || null;
        } else {
          console.log("Yahoo fundamentals HTTP:", fundamentalsResponse.status);

          console.log(await fundamentalsResponse.text());
        }
      } catch (error) {
        console.log("Yahoo fundamentals failed:", error);
      }
    }

    // ========================================================
    // 6. EXTRACT FUNDAMENTALS
    // ========================================================

    const summary = fundamentals?.summaryDetail || {};

    const statistics = fundamentals?.defaultKeyStatistics || {};

    const financial = fundamentals?.financialData || {};

    const profile = fundamentals?.assetProfile || {};

    const priceInfo = fundamentals?.price || {};

    const fundamentalData = {
      market_cap: raw(summary.marketCap) ?? raw(priceInfo.marketCap),

      pe: raw(summary.trailingPE) ?? raw(statistics.trailingPE),

      forward_pe: raw(summary.forwardPE) ?? raw(statistics.forwardPE),

      peg_ratio: raw(statistics.pegRatio),

      price_to_book: raw(statistics.priceToBook),

      book_value: raw(statistics.bookValue),

      eps: raw(statistics.trailingEps),

      dividend_yield: raw(summary.dividendYield),

      dividend_rate: raw(summary.dividendRate),

      beta: raw(summary.beta),

      profit_margin: raw(financial.profitMargins),

      operating_margin: raw(financial.operatingMargins),

      return_on_equity: raw(financial.returnOnEquity),

      return_on_assets: raw(financial.returnOnAssets),

      revenue: raw(financial.totalRevenue),

      revenue_per_share: raw(financial.revenuePerShare),

      earnings_growth: raw(financial.earningsGrowth),

      revenue_growth: raw(financial.revenueGrowth),

      gross_profit: raw(financial.grossProfits),

      free_cash_flow: raw(financial.freeCashflow),

      total_cash: raw(financial.totalCash),

      total_debt: raw(financial.totalDebt),

      sector: profile.sector || null,

      industry: profile.industry || null,

      website: profile.website || null,

      description: profile.longBusinessSummary || null,
    };

    // ========================================================
    // 6b. FINAL PREVIOUS CLOSE
    //     Prefer Yahoo's own quote previous close (always the last
    //     completed session before the live one, even when the daily
    //     candle series is missing days). Fall back to candles.
    // ========================================================

    const quotePrevClose = raw(priceInfo.regularMarketPreviousClose);
    const quotePrevUsable = quotePrevClose !== null && quotePrevClose > 0;

    const previousClose: number | null = quotePrevUsable
      ? quotePrevClose
      : candlePrevClose;
    const previousCloseSource = quotePrevUsable
      ? "yahoo quote"
      : candlePrevClose !== null
      ? "daily candles"
      : null;

    const change = price !== null && previousClose !== null
      ? price - previousClose
      : null;
    const changePercent =
      change !== null && previousClose ? (change / previousClose) * 100 : null;

    console.log(
      "PRICE_DEBUG",
      JSON.stringify({
        symbol,
        hasCrumb: !!crumb,
        hasFundamentals: !!fundamentals,
        metaPrice,
        sessionDate,
        price,
        previousClose,
        previousCloseSource,
        quotePrevClose,
        candlePrevClose,
        prevDate: prevBar ? prevBar[0] : null,
        lastBars: bars.slice(-4).map(([d, i]) => [d, closes[i]]),
      })
    );

    // ========================================================
    // 7. HISTORY
    // ========================================================

    const history = timestamps.map((timestamp: number, index: number) => ({
      timestamp,

      date: new Date(timestamp * 1000).toISOString(),

      open: quote.open?.[index] ?? null,

      high: quote.high?.[index] ?? null,

      low: quote.low?.[index] ?? null,

      close: quote.close?.[index] ?? null,

      volume: quote.volume?.[index] ?? null,
    }));

    // ========================================================
    // 8. RESPONSE
    // ========================================================

    return json(
      {
        success: true,

        symbol,

        yahoo_symbol: yahooSymbol,

        company_name: meta.longName || meta.shortName || symbol,

        exchange: meta.exchangeName || "NSE",

        currency: meta.currency || "INR",

        price,

        previous_close: previousClose,

        previous_close_source: previousCloseSource,

        change,

        change_percent: changePercent,

        open: latestIndex >= 0 ? quote.open?.[latestIndex] ?? null : null,

        high: latestIndex >= 0 ? quote.high?.[latestIndex] ?? null : null,

        low: latestIndex >= 0 ? quote.low?.[latestIndex] ?? null : null,

        volume: latestIndex >= 0 ? quote.volume?.[latestIndex] ?? null : null,

        high_52w: raw(meta.fiftyTwoWeekHigh) ?? raw(summary.fiftyTwoWeekHigh),

        low_52w: raw(meta.fiftyTwoWeekLow) ?? raw(summary.fiftyTwoWeekLow),

        fundamentals: fundamentalData,

        history,

        source: "Yahoo Finance",

        fetched_at: new Date().toISOString(),

        latest_trading_timestamp:
          latestIndex >= 0 ? timestamps[latestIndex] : null,

        latest_trading_date_ist: sessionDate,

        quote_source_mode: metaIsUsable
          ? "Yahoo regularMarket snapshot"
          : "Yahoo daily chart",
      },
      200
    );
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error: (error as any)?.message || "Unknown error",
      },
      500
    );
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,

    headers: {
      ...corsHeaders,

      "Content-Type": "application/json",

      // Do not let a CDN/browser keep an old market-day response.
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
    },
  });
}
