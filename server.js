import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import cors from "cors";

dotenv.config();
const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://smart-recipe-finder-frontend.onrender.com",
      "https://codesandbox.io",
    ],
  })
);
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// -----------------------------
// Local Recipe Database
// -----------------------------
const localRecipes = [
  {
    name: "Chicken Biryani",
    keywords: ["chicken", "rice", "biryani"],
    ingredients: [
      "2 cups basmati rice",
      "500g chicken",
      "2 onions (sliced)",
      "2 tomatoes (chopped)",
      "1 cup curd",
      "Spices: garam masala, chili powder, turmeric, salt",
      "Fresh coriander & mint leaves",
    ],
    steps: [
      "Marinate chicken with curd and spices for 30 minutes.",
      "Fry onions until golden brown.",
      "Add chicken and cook until tender.",
      "Add rice and water, then cook until rice is fluffy.",
      "Garnish with coriander and mint, serve hot!",
    ],
  },
  {
    name: "Paneer Butter Masala",
    keywords: ["paneer", "butter", "gravy"],
    ingredients: [
      "200g paneer cubes",
      "2 tomatoes",
      "1 onion",
      "1 tbsp butter",
      "Cream, garam masala, salt, chili powder",
    ],
    steps: [
      "Blend tomatoes and onions into puree.",
      "Fry in butter with spices.",
      "Add paneer cubes and cook for 5 minutes.",
      "Stir in cream and serve with roti or rice.",
    ],
  },
  {
    name: "Egg Fried Rice",
    keywords: ["egg", "rice", "snack", "fried"],
    ingredients: [
      "2 eggs",
      "2 cups cooked rice",
      "1 onion, chopped",
      "1 tbsp soy sauce",
      "Salt and pepper to taste",
    ],
    steps: [
      "Scramble eggs in a pan.",
      "Add onions and stir-fry.",
      "Mix in cooked rice and soy sauce.",
      "Season and serve hot.",
    ],
  },
  {
    name: "Veg Sandwich",
    keywords: ["snack", "sandwich", "veg"],
    ingredients: [
      "2 slices of bread",
      "1 small tomato, sliced",
      "1 cucumber, sliced",
      "1 cheese slice",
      "Butter and salt to taste",
    ],
    steps: [
      "Spread butter on bread.",
      "Layer vegetables and cheese.",
      "Grill or toast for 2–3 minutes.",
      "Cut and serve warm.",
    ],
  },
  {
    name: "Gulab Jamun",
    keywords: ["dessert", "sweet", "gulab", "gulab jamun", "sweets"],
    ingredients: [
      "1 cup milk powder",
      "1/4 cup all-purpose flour",
      "A pinch of baking soda",
      "2 tbsp ghee",
      "Warm milk (to knead)",
      "Sugar syrup with cardamom and rose water",
    ],
    steps: [
      "Mix milk powder, flour, baking soda, and ghee.",
      "Add milk gradually to form a soft dough.",
      "Shape into small balls and fry on low heat until golden.",
      "Soak in warm sugar syrup for 1 hour.",
    ],
  },
];

// -----------------------------
// Levenshtein Correction
// -----------------------------
function levenshtein(a = "", b = "") {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const matrix = Array.from({ length: n + 1 }, () => new Array(m + 1));
  for (let i = 0; i <= n; i++) matrix[i][0] = i;
  for (let j = 0; j <= m; j++) matrix[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[n][m];
}

const allKeywords = [
  "chicken",
  "paneer",
  "rice",
  "snack",
  "snacks",
  "dessert",
  "sweet",
  "biryani",
  "egg",
  "sandwich",
  "sandwiches",
];

function correctToken(token) {
  if (!token || token.length <= 1) return token;
  let best = token;
  let bestDist = Infinity;
  for (const kw of allKeywords) {
    const dist = levenshtein(token, kw);
    if (dist < bestDist) {
      bestDist = dist;
      best = kw;
    }
  }
  const threshold = Math.max(1, Math.floor(best.length * 0.35));
  return bestDist <= threshold ? best : token;
}

// -----------------------------
// MealDB Helper
// -----------------------------
async function getMealsFromAPI(keyword) {
  try {
    const res = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(keyword)}`
    );
    return res.data.meals ? res.data.meals.slice(0, 5) : [];
  } catch (e) {
    console.error("MealDB error:", e.message || e);
    return [];
  }
}

// -----------------------------
// Routes
// -----------------------------
app.get("/", (req, res) => {
  res.send("🍳 Smart Recipe Assistant backend running (LocalDB → Gemini → MealDB)");
});

app.post("/api/chat", async (req, res) => {
  try {
    const raw = (req.body.prompt || req.body.message || "").toString();
    if (!raw)
      return res.status(400).json({ error: "Missing 'prompt' in request body" });

    const normalized = raw.toLowerCase().replace(/[,;!?]/g, " ");
    const tokens = normalized
      .split(/\b(?:and|with|&)\b|\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const correctedTokens = tokens.map((t) => correctToken(t));
    const uniqueTokens = Array.from(new Set(correctedTokens));

    console.log("🔤 Raw input:", raw);
    console.log("🔤 Tokens:", tokens);
    console.log("🔤 Corrected:", uniqueTokens);

    // ----------------- Step 1: Local DB -----------------
    const scoredLocal = localRecipes
      .map((r) => {
        const matches = uniqueTokens.filter((tk) =>
          r.keywords.some((k) => k.includes(tk) || tk.includes(k))
        );
        return { recipe: r, score: matches.length };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredLocal.length > 0) {
      const topScore = scoredLocal[0].score;
      const topMatches = scoredLocal
        .filter((s) => s.score === topScore)
        .map((s) => s.recipe);

      const reply = topMatches
        .map(
          (r) => `🍽️ **${r.name}**

### 🧂 Ingredients
${r.ingredients.map((i) => `- ${i}`).join("\n")}

### 👨‍🍳 Steps
${r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
        )
        .join("\n\n");
      return res.json({ reply });
    }

    // ----------------- Step 2: Gemini Fallback -----------------
    if (GEMINI_API_KEY) {
      try {
        const aiRes = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            contents: [
              {
                parts: [
                  {
                    text: `You are a helpful recipe assistant. The user said: "${raw}". 
If the user listed ingredients, suggest 3–5 dishes that use them and give one Markdown recipe.`,
                  },
                ],
              },
            ],
          },
          { headers: { "Content-Type": "application/json" } }
        );

        const aiText = aiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (aiText && aiText.trim()) return res.json({ reply: aiText });
      } catch (err) {
        console.error("Gemini error:", err?.response?.data || err.message);
      }
    }

    // ----------------- Step 3: MealDB (last fallback) -----------------
    let allMeals = [];
    for (const tk of uniqueTokens) {
      if (tk.length < 2) continue;
      const meals = await getMealsFromAPI(tk);
      if (meals.length > 0) {
        allMeals.push(
          ...meals.map((m) => ({
            name: m.strMeal,
            thumb: m.strMealThumb,
            id: m.idMeal,
          }))
        );
      }
    }

    allMeals = allMeals.filter(
      (v, i, a) => a.findIndex((t) => t.name === v.name) === i
    );

    if (allMeals.length > 0) {
      const reply =
        "🍴 Here are some dishes based on your ingredients:\n\n" +
        allMeals
          .slice(0, 8)
          .map(
            (m) =>
              `🍽️ **${m.name}**\n${
                m.thumb ? `![${m.name}](${m.thumb})` : ""
              }`
          )
          .join("\n\n") +
        "\n\nWould you like the recipe for any of these?";
      return res.json({ reply });
    }

    // ----------------- Final Fallback -----------------
    return res.json({
      reply:
        "😕 Sorry, I couldn’t find a recipe for that. Try: 'chicken', 'paneer', or 'sandwich'.",
    });
  } catch (err) {
    console.error("❌ Server Error:", err);
    return res.json({
      reply: "⚠️ Oops — something went wrong. Please try again later.",
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
