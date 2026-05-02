const siteHeader = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  siteNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      siteNav.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

if (siteHeader) {
  const syncHeaderShadow = () => {
    siteHeader.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  syncHeaderShadow();
  window.addEventListener("scroll", syncHeaderShadow, { passive: true });
}

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const targetId = anchor.getAttribute("href");

    if (!targetId || targetId === "#") {
      return;
    }

    const target = document.querySelector(targetId);

    if (!target) {
      return;
    }

    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

if (document.querySelector(".category-strip") && document.querySelector(".recipes-grid")) {
  const categoryCards = document.querySelectorAll(".category-card[data-category]");
  const recipeCards = document.querySelectorAll(".recipe-card[data-category]");
  let activeCategory = "";

  const applyFilter = (selectedCategory) => {
    recipeCards.forEach((card) => {
      card.classList.add("fading");
    });

    window.setTimeout(() => {
      recipeCards.forEach((card) => {
        const matches = !selectedCategory || card.dataset.category === selectedCategory;
        card.classList.toggle("hidden", !matches);
      });

      requestAnimationFrame(() => {
        recipeCards.forEach((card) => {
          card.classList.remove("fading");
        });
      });
    }, 140);
  };

  categoryCards.forEach((card) => {
    card.addEventListener("click", () => {
      const selectedCategory = card.dataset.category || "";
      activeCategory = activeCategory === selectedCategory ? "" : selectedCategory;

      categoryCards.forEach((item) => {
        const isActive = item.dataset.category === activeCategory;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-pressed", String(isActive));
      });

      applyFilter(activeCategory);
    });
  });
}

const recipeTemplate = document.querySelector("[data-recipe-template]");

if (recipeTemplate) {
  const recipeCatalog = {
    "whipped-ricotta-toast": {
      category: "Breakfast",
      title: "Whipped Ricotta Toast with Roasted Figs",
      description:
        "Crisp sourdough layered with lemony whipped ricotta, warm roasted figs, and a drizzle of thyme honey for a slow, elegant breakfast.",
      image:
        "https://images.unsplash.com/photo-1482049016688-2d3e1b311543?auto=format&fit=crop&w=1400&q=80",
      alt: "Whipped ricotta toast topped with fruit",
      prepTime: "15 min",
      cookTime: "10 min",
      servings: "2",
      difficulty: "Easy",
      nutrition: {
        calories: "420",
        protein: "14g",
        carbs: "38g",
        fat: "23g",
      },
      ingredients: [
        "4 slices sourdough bread",
        "1 cup whole milk ricotta",
        "1 teaspoon lemon zest",
        "1 teaspoon lemon juice",
        "6 fresh figs, halved",
        "1 tablespoon olive oil",
        "2 tablespoons honey",
        "1 teaspoon fresh thyme leaves",
        "2 tablespoons chopped pistachios",
        "Flaky sea salt to finish",
      ],
      instructions: [
        "Heat the oven to 400°F and place the halved figs on a small tray with olive oil and a pinch of salt.",
        "Roast the figs until softened and lightly caramelized, about 10 minutes.",
        "Whip the ricotta with lemon zest and lemon juice until smooth and airy.",
        "Toast the sourdough until deeply golden and crisp around the edges.",
        "Spread each toast generously with whipped ricotta, then top with the warm figs.",
        "Finish with honey, thyme, pistachios, and flaky salt before serving immediately.",
      ],
      related: ["charred-peach-salad", "blood-orange-olive-oil-cake", "coconut-green-curry"],
    },
    "charred-peach-salad": {
      category: "Lunch",
      title: "Charred Peach and Burrata Garden Salad",
      description:
        "Juicy peaches, creamy burrata, and peppery greens finished with balsamic glaze make this an easy lunch with dinner-party polish.",
      image:
        "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=1400&q=80",
      alt: "Summer salad with peaches and greens",
      prepTime: "20 min",
      cookTime: "5 min",
      servings: "4",
      difficulty: "Easy",
      nutrition: {
        calories: "360",
        protein: "12g",
        carbs: "22g",
        fat: "24g",
      },
      ingredients: [
        "3 ripe peaches, halved",
        "5 ounces mixed greens",
        "8 ounces burrata",
        "1 small cucumber, shaved",
        "1/2 small red onion, thinly sliced",
        "2 tablespoons olive oil",
        "1 tablespoon balsamic glaze",
        "1 tablespoon white wine vinegar",
        "1/4 cup torn basil leaves",
        "Sea salt and cracked black pepper",
      ],
      instructions: [
        "Heat a grill pan over medium-high heat and brush the peaches lightly with olive oil.",
        "Char the peaches cut-side down until grill marks appear and the fruit softens slightly.",
        "Arrange the greens, cucumber, and red onion across a large serving platter.",
        "Tear the burrata over the salad and nestle the warm peaches throughout.",
        "Whisk the remaining olive oil with vinegar, salt, and pepper, then spoon over the salad.",
        "Finish with balsamic glaze and basil just before serving.",
      ],
      related: ["grilled-salmon-quinoa-power-bowl", "whipped-ricotta-toast", "coconut-green-curry"],
    },
    "grilled-salmon-quinoa-power-bowl": {
      category: "Lunch",
      title: "Grilled Salmon Quinoa Power Bowl",
      description:
        "Herb-grilled salmon, fluffy quinoa, avocado, charred corn, tomatoes, and radishes are finished with a bright lemon-dill dressing.",
      image: "assets/grilled-salmon-quinoa-power-bowl.jpeg",
      alt: "Grilled salmon quinoa bowl with avocado, charred corn, tomatoes, radishes, lemon, dill, and green dressing",
      prepTime: "20 min",
      cookTime: "18 min",
      servings: "2",
      difficulty: "Easy",
      nutrition: {
        calories: "620",
        protein: "38g",
        carbs: "48g",
        fat: "32g",
      },
      ingredients: [
        "2 salmon fillets, about 6 ounces each",
        "1 cup cooked quinoa",
        "1 ripe avocado, sliced",
        "1 cup corn kernels, charred",
        "1/2 red bell pepper, sliced",
        "1 cup halved cherry tomatoes",
        "3 radishes, thinly sliced",
        "1 jalapeno, thinly sliced",
        "2 tablespoons pumpkin seeds",
        "1 lemon, cut into wedges",
        "2 tablespoons chopped fresh dill",
        "2 tablespoons chopped cilantro",
        "2 tablespoons olive oil",
        "1 tablespoon lemon juice",
        "1 teaspoon Dijon mustard",
        "1 teaspoon honey",
        "1 small garlic clove, grated",
        "Sea salt and cracked black pepper",
      ],
      instructions: [
        "Pat the salmon dry, then season with olive oil, salt, pepper, and half of the chopped dill.",
        "Whisk lemon juice, Dijon, honey, garlic, olive oil, salt, pepper, and the remaining dill into a bright dressing.",
        "Grill or sear the salmon over medium-high heat until browned outside and just cooked through, about 4 minutes per side.",
        "Warm the quinoa and divide it between two shallow bowls.",
        "Arrange the salmon, avocado, charred corn, bell pepper, tomatoes, radishes, jalapeno, and lemon wedges over the quinoa.",
        "Drizzle with lemon-dill dressing, then finish with pumpkin seeds and cilantro before serving.",
      ],
      related: ["charred-peach-salad", "citrus-fennel-salad", "coconut-green-curry"],
    },
    "herb-crusted-roast-chicken": {
      category: "Dinner",
      title: "Herb-Crusted Roast Chicken",
      description:
        "Golden skin, fresh herbs, and a bright lemon jus make this roast chicken feel equal parts Sunday ritual and dinner-party main event.",
      image:
        "https://images.unsplash.com/photo-1518492104633-130d0cc84637?auto=format&fit=crop&w=1400&q=80",
      alt: "Herb-crusted roast chicken on a serving platter",
      prepTime: "20 min",
      cookTime: "1 hr 20 min",
      servings: "4",
      difficulty: "Medium",
      nutrition: {
        calories: "540",
        protein: "42g",
        carbs: "6g",
        fat: "38g",
      },
      ingredients: [
        "1 whole chicken, about 4 pounds",
        "3 tablespoons unsalted butter, softened",
        "2 tablespoons olive oil",
        "4 garlic cloves, finely grated",
        "1 tablespoon chopped rosemary",
        "1 tablespoon chopped thyme",
        "1 tablespoon chopped parsley",
        "1 lemon, halved",
        "1 teaspoon flaky sea salt",
        "1/2 teaspoon cracked black pepper",
      ],
      instructions: [
        "Pat the chicken dry and let it rest at room temperature for 20 minutes while the oven heats to 425°F.",
        "Stir the butter, olive oil, garlic, rosemary, thyme, parsley, salt, and pepper into a fragrant herb paste.",
        "Rub the herb paste all over the chicken and tuck the lemon halves into the cavity for moisture and aroma.",
        "Roast for 20 minutes, then lower the heat to 375°F and continue roasting until the thickest part reaches 165°F.",
        "Rest the chicken for 15 minutes, then spoon the pan juices into a small saucepan and simmer with an extra squeeze of lemon.",
        "Carve, drizzle with the lemon jus, and finish with more herbs and a pinch of flaky sea salt.",
      ],
      related: ["blood-orange-olive-oil-cake", "chili-crab-linguine", "coconut-green-curry"],
    },
    "blood-orange-olive-oil-cake": {
      category: "Desserts",
      title: "Blood Orange Olive Oil Cake",
      description:
        "Fragrant citrus crumb and a glossy orange glaze give this tender olive oil cake a dramatic but effortless finish.",
      image:
        "https://images.unsplash.com/photo-1464306076886-da185f6a9d05?auto=format&fit=crop&w=1400&q=80",
      alt: "Citrus olive oil cake on a plate",
      prepTime: "20 min",
      cookTime: "35 min",
      servings: "8",
      difficulty: "Easy",
      nutrition: {
        calories: "390",
        protein: "5g",
        carbs: "46g",
        fat: "21g",
      },
      ingredients: [
        "1 1/2 cups all-purpose flour",
        "1 teaspoon baking powder",
        "1/2 teaspoon fine sea salt",
        "3/4 cup granulated sugar",
        "3 large eggs",
        "1/2 cup extra-virgin olive oil",
        "1/2 cup Greek yogurt",
        "1 tablespoon blood orange zest",
        "1/3 cup blood orange juice",
        "1 cup powdered sugar",
      ],
      instructions: [
        "Heat the oven to 350°F and grease an 8-inch cake pan, lining the bottom with parchment.",
        "Whisk the flour, baking powder, and salt in a medium bowl.",
        "In a second bowl, whisk the sugar, eggs, olive oil, yogurt, zest, and half of the orange juice until smooth.",
        "Fold the dry ingredients into the wet just until no streaks remain.",
        "Bake until the cake is golden and a tester comes out clean, about 35 minutes.",
        "Whisk the remaining juice with powdered sugar, then spoon the glaze over the cooled cake.",
      ],
      related: ["whipped-ricotta-toast", "herb-crusted-roast-chicken", "charred-peach-salad"],
    },
    "chili-crab-linguine": {
      category: "Pasta & Noodles",
      title: "Chili Crab Linguine",
      description:
        "Silky pasta coated in a spicy tomato-crab sauce with lemon and herbs for a briny, weeknight-luxury bowl.",
      image:
        "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=1400&q=80",
      alt: "Plate of chili crab linguine",
      prepTime: "15 min",
      cookTime: "20 min",
      servings: "4",
      difficulty: "Medium",
      nutrition: {
        calories: "610",
        protein: "28g",
        carbs: "64g",
        fat: "24g",
      },
      ingredients: [
        "12 ounces linguine",
        "2 tablespoons olive oil",
        "3 garlic cloves, sliced",
        "1 shallot, finely chopped",
        "1 teaspoon red pepper flakes",
        "1 tablespoon tomato paste",
        "1 cup crushed tomatoes",
        "8 ounces lump crab meat",
        "1 lemon, zested and juiced",
        "1/4 cup chopped parsley",
      ],
      instructions: [
        "Cook the linguine in salted water until just shy of al dente and reserve 1 cup of the pasta water.",
        "Warm the olive oil in a large skillet, then soften the shallot and garlic with the pepper flakes.",
        "Stir in the tomato paste and crushed tomatoes, simmering until the sauce becomes glossy and concentrated.",
        "Add the crab meat gently so it stays in large pieces, then season with lemon zest.",
        "Toss in the pasta with enough reserved pasta water to loosen the sauce and coat every strand.",
        "Finish with lemon juice and parsley, then serve immediately.",
      ],
      related: ["herb-crusted-roast-chicken", "coconut-green-curry", "charred-peach-salad"],
    },
    "creamy-mushroom-spinach-penne": {
      category: "Pasta & Noodles",
      title: "Creamy Mushroom Spinach Penne Bake",
      description:
        "Tender penne, sauteed mushrooms, and wilted spinach are folded under a garlic-Parmesan cream sauce for a cozy baked pasta.",
      image: "assets/creamy-mushroom-spinach-penne.jpeg",
      alt: "Cream sauce being poured over penne pasta with mushrooms and spinach",
      prepTime: "15 min",
      cookTime: "25 min",
      servings: "6",
      difficulty: "Easy",
      nutrition: {
        calories: "520",
        protein: "17g",
        carbs: "58g",
        fat: "25g",
      },
      ingredients: [
        "1 pound penne pasta",
        "2 tablespoons olive oil",
        "12 ounces cremini mushrooms, sliced",
        "4 garlic cloves, minced",
        "5 ounces baby spinach",
        "3 tablespoons unsalted butter",
        "3 tablespoons all-purpose flour",
        "2 cups whole milk",
        "1 cup heavy cream",
        "1 cup finely grated Parmesan cheese",
        "1 teaspoon Italian seasoning",
        "1/2 teaspoon kosher salt",
        "1/2 teaspoon cracked black pepper",
        "1 cup shredded mozzarella cheese",
      ],
      instructions: [
        "Heat the oven to 375°F and lightly grease a 9-by-13-inch baking dish.",
        "Cook the penne in well-salted water until just shy of al dente, then drain and transfer it to the baking dish.",
        "Warm the olive oil in a large skillet, then saute the mushrooms until browned and their moisture has cooked off.",
        "Stir in the garlic and spinach, cooking just until the spinach wilts, then fold the mixture through the pasta.",
        "Melt the butter in the same skillet, whisk in the flour, then slowly whisk in the milk and cream until smooth and lightly thickened.",
        "Stir in the Parmesan, Italian seasoning, salt, and pepper, then pour the sauce over the pasta and scatter mozzarella on top.",
        "Bake until bubbling around the edges and lightly golden on top, about 15 minutes, then rest for 5 minutes before serving.",
      ],
      related: ["chili-crab-linguine", "roasted-tomato-basil-soup", "sea-salt-focaccia"],
    },
    "coconut-green-curry": {
      category: "Vegan",
      title: "Coconut Green Curry with Crispy Shallots",
      description:
        "Velvety coconut broth, tender vegetables, and bright herbs create a plant-forward dinner with layered heat and fragrance.",
      image:
        "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1400&q=80",
      alt: "Bowl of green curry with vegetables",
      prepTime: "20 min",
      cookTime: "20 min",
      servings: "4",
      difficulty: "Easy",
      nutrition: {
        calories: "470",
        protein: "12g",
        carbs: "32g",
        fat: "34g",
      },
      ingredients: [
        "2 tablespoons neutral oil",
        "2 shallots, thinly sliced",
        "3 tablespoons green curry paste",
        "1 tablespoon grated ginger",
        "2 garlic cloves, minced",
        "1 can full-fat coconut milk",
        "1 cup vegetable stock",
        "2 cups broccoli florets",
        "1 red bell pepper, sliced",
        "1 cup snap peas",
      ],
      instructions: [
        "Fry the shallots in hot oil until crisp and golden, then transfer to paper towels and season lightly.",
        "Pour off all but 1 tablespoon of the oil and cook the curry paste, ginger, and garlic until fragrant.",
        "Add the coconut milk and stock, stirring until the paste dissolves into a smooth broth.",
        "Simmer the broccoli and bell pepper until almost tender, then add the snap peas.",
        "Cook until the vegetables are vibrant and just tender, seasoning the broth to taste.",
        "Serve over rice and top with the crispy shallots and extra herbs.",
      ],
      related: ["charred-peach-salad", "chili-crab-linguine", "herb-crusted-roast-chicken"],
    },
    "crispy-halloumi-hot-honey": {
      category: "Snacks",
      title: "Crispy Halloumi with Hot Honey",
      description:
        "Golden halloumi with warm chile honey and citrus makes an easy snack plate that lands somewhere between cocktail hour and dessert.",
      image:
        "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1400&q=80",
      alt: "Snack plate with cheese and garnish",
      prepTime: "10 min",
      cookTime: "8 min",
      servings: "4",
      difficulty: "Easy",
      nutrition: {
        calories: "310",
        protein: "14g",
        carbs: "18g",
        fat: "20g",
      },
      ingredients: [
        "8 ounces halloumi, sliced",
        "1 tablespoon olive oil",
        "3 tablespoons honey",
        "1 teaspoon chili flakes",
        "1 teaspoon lemon zest",
        "1 teaspoon lemon juice",
        "2 tablespoons toasted pistachios",
        "Fresh mint leaves",
        "Cracked black pepper",
        "Warm flatbread, for serving",
      ],
      instructions: [
        "Pat the halloumi dry and slice into thick planks.",
        "Warm the olive oil in a skillet and sear the cheese until both sides are deeply golden.",
        "Heat the honey with chili flakes just until loose and fragrant.",
        "Arrange the halloumi on a platter and spoon the hot honey over the top.",
        "Finish with lemon zest, lemon juice, pistachios, and mint.",
        "Serve warm with flatbread or crisp crackers.",
      ],
      related: ["rosemary-grapefruit-spritz", "whipped-ricotta-toast", "blood-orange-olive-oil-cake"],
    },
    "rosemary-grapefruit-spritz": {
      category: "Drinks & Cocktails",
      title: "Rosemary Grapefruit Spritz",
      description:
        "A bright, bitter-citrus spritz sharpened with rosemary syrup and sparkling wine for an aperitif that feels clean and celebratory.",
      image:
        "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=1400&q=80",
      alt: "Grapefruit cocktail in a glass",
      prepTime: "10 min",
      cookTime: "5 min",
      servings: "2",
      difficulty: "Easy",
      nutrition: {
        calories: "180",
        protein: "0g",
        carbs: "16g",
        fat: "0g",
      },
      ingredients: [
        "1/4 cup sugar",
        "1/4 cup water",
        "2 rosemary sprigs",
        "3 ounces fresh grapefruit juice",
        "2 ounces Aperol",
        "4 ounces sparkling wine",
        "2 ounces chilled soda water",
        "Ice cubes",
        "Grapefruit wedges, for garnish",
        "Extra rosemary sprigs, for garnish",
      ],
      instructions: [
        "Simmer the sugar, water, and rosemary together for 5 minutes, then cool and strain.",
        "Fill two glasses with ice.",
        "Divide the grapefruit juice, Aperol, and 1 tablespoon rosemary syrup between the glasses.",
        "Top each glass with sparkling wine and soda water.",
        "Stir gently to combine without flattening the bubbles.",
        "Garnish with grapefruit wedges and fresh rosemary before serving.",
      ],
      related: ["crispy-halloumi-hot-honey", "blood-orange-olive-oil-cake", "charred-peach-salad"],
    },
    "roasted-tomato-basil-soup": {
      category: "Soups & Stews",
      title: "Roasted Tomato Basil Soup",
      description:
        "Slow-roasted tomatoes and sweet onions blend into a velvety soup finished with basil and a little cream.",
      image:
        "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1400&q=80",
      alt: "Bowl of roasted tomato soup",
      prepTime: "15 min",
      cookTime: "45 min",
      servings: "4",
      difficulty: "Easy",
      nutrition: {
        calories: "260",
        protein: "5g",
        carbs: "18g",
        fat: "18g",
      },
      ingredients: [
        "2 pounds ripe tomatoes, halved",
        "1 yellow onion, sliced",
        "4 garlic cloves",
        "3 tablespoons olive oil",
        "1 teaspoon kosher salt",
        "1/2 teaspoon black pepper",
        "2 cups vegetable stock",
        "1/4 cup heavy cream",
        "1/2 cup basil leaves",
        "Croutons, for serving",
      ],
      instructions: [
        "Heat the oven to 425°F and arrange the tomatoes, onion, and garlic on a sheet pan.",
        "Drizzle with olive oil, season, and roast until deeply collapsed and caramelized.",
        "Transfer the vegetables to a pot and add the stock.",
        "Blend until smooth using an immersion blender or countertop blender.",
        "Stir in the cream and basil, then warm gently without boiling.",
        "Serve with croutons and extra basil on top.",
      ],
      related: ["herb-crusted-roast-chicken", "sea-salt-focaccia", "coconut-green-curry"],
    },
    "citrus-fennel-salad": {
      category: "Salads",
      title: "Citrus Fennel Salad with Pistachios",
      description:
        "Shaved fennel, oranges, and herbs create a crisp, bright salad with enough texture to carry a full meal.",
      image:
        "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1400&q=80",
      alt: "Fresh salad with greens and citrus",
      prepTime: "20 min",
      cookTime: "0 min",
      servings: "4",
      difficulty: "Easy",
      nutrition: {
        calories: "240",
        protein: "4g",
        carbs: "16g",
        fat: "18g",
      },
      ingredients: [
        "2 fennel bulbs, shaved thin",
        "2 oranges, segmented",
        "1 avocado, sliced",
        "3 cups arugula",
        "1/4 cup chopped mint",
        "1/4 cup chopped dill",
        "1/4 cup toasted pistachios",
        "3 tablespoons olive oil",
        "1 tablespoon lemon juice",
        "Sea salt and black pepper",
      ],
      instructions: [
        "Shave the fennel very thinly and soak briefly in ice water for extra crispness, then drain well.",
        "Arrange the arugula, fennel, orange segments, and avocado on a platter.",
        "Scatter the mint, dill, and pistachios over the top.",
        "Whisk the olive oil with lemon juice, salt, and pepper.",
        "Drizzle the dressing over the salad just before serving.",
        "Finish with extra fennel fronds for a fresh, aromatic garnish.",
      ],
      related: ["charred-peach-salad", "rosemary-grapefruit-spritz", "coconut-green-curry"],
    },
    "sea-salt-focaccia": {
      category: "Baking & Bread",
      title: "Sea Salt Focaccia with Rosemary",
      description:
        "This airy focaccia bakes up with a crisp olive oil crust, tender interior, and rosemary-scented top.",
      image:
        "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1400&q=80",
      alt: "Fresh rosemary focaccia bread",
      prepTime: "20 min",
      cookTime: "25 min",
      servings: "8",
      difficulty: "Medium",
      nutrition: {
        calories: "290",
        protein: "6g",
        carbs: "42g",
        fat: "10g",
      },
      ingredients: [
        "4 cups bread flour",
        "2 teaspoons kosher salt",
        "2 1/4 teaspoons instant yeast",
        "1 3/4 cups warm water",
        "1/4 cup olive oil, plus more for the pan",
        "2 rosemary sprigs, chopped",
        "Flaky sea salt",
        "1 teaspoon honey",
        "1 tablespoon semolina flour",
        "Freshly cracked black pepper",
      ],
      instructions: [
        "Mix the flour, kosher salt, yeast, honey, water, and olive oil into a shaggy dough.",
        "Let the dough rise until doubled, then transfer it to a well-oiled pan.",
        "Stretch the dough gently to fill the pan and let it rise again until pillowy.",
        "Dimple the surface with oiled fingers and drizzle generously with olive oil.",
        "Top with rosemary, flaky salt, and black pepper.",
        "Bake at 425°F until the focaccia is deeply golden and crisp around the edges.",
      ],
      related: ["roasted-tomato-basil-soup", "whipped-ricotta-toast", "herb-crusted-roast-chicken"],
    },
    "harissa-grilled-chicken-skewers": {
      category: "Grilling & BBQ",
      title: "Harissa Grilled Chicken Skewers",
      description:
        "Smoky chicken skewers marinated in harissa, garlic, and lemon for a fast grill recipe with plenty of character.",
      image:
        "https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1400&q=80",
      alt: "Grilled chicken skewers on a platter",
      prepTime: "20 min",
      cookTime: "12 min",
      servings: "4",
      difficulty: "Easy",
      nutrition: {
        calories: "430",
        protein: "34g",
        carbs: "8g",
        fat: "28g",
      },
      ingredients: [
        "1 1/2 pounds boneless chicken thighs",
        "2 tablespoons harissa paste",
        "2 tablespoons olive oil",
        "2 garlic cloves, grated",
        "1 tablespoon lemon juice",
        "1 teaspoon ground cumin",
        "1/2 teaspoon smoked paprika",
        "1/2 cup Greek yogurt",
        "2 tablespoons chopped cilantro",
        "Lemon wedges, for serving",
      ],
      instructions: [
        "Cut the chicken into large bite-size pieces and toss with harissa, olive oil, garlic, lemon juice, cumin, and paprika.",
        "Marinate for at least 20 minutes while the grill heats to medium-high.",
        "Thread the chicken onto skewers and season lightly with salt.",
        "Grill, turning every few minutes, until charred in spots and cooked through.",
        "Stir the yogurt with chopped cilantro and a squeeze of lemon.",
        "Serve the skewers hot with the herbed yogurt and extra lemon wedges.",
      ],
      related: ["herb-crusted-roast-chicken", "rosemary-grapefruit-spritz", "crispy-halloumi-hot-honey"],
    },
  };

  const getSlugFromPath = () => {
    const match = window.location.pathname.match(/\/recipes\/([^/]+)\.html$/);
    return match ? decodeURIComponent(match[1]) : "";
  };

  const defaultRecipeSlug = "herb-crusted-roast-chicken";
  const requestedRecipeSlug =
    recipeTemplate.dataset.recipeSlug ||
    getSlugFromPath() ||
    new URLSearchParams(window.location.search).get("recipe") ||
    defaultRecipeSlug;
  const recipeSlug = requestedRecipeSlug in recipeCatalog ? requestedRecipeSlug : defaultRecipeSlug;
  const recipe = recipeCatalog[recipeSlug];
  const recipeUrl = `recipes/${recipeSlug}.html`;
  const recipeAbsoluteUrl = new URL(recipeUrl, document.baseURI).href;
  const recipeImageAbsoluteUrl = new URL(recipe.image, document.baseURI).href;
  const relatedCatalog = recipe.related.map((slug) => [slug, recipeCatalog[slug]]).filter((entry) => entry[1]);

  const getRecipeHref = (slug) => `recipes/${slug}.html`;

  const setText = (selector, value) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  };

  const setHtml = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) {
      element.innerHTML = value;
    }
  };

  setText("[data-breadcrumb-category]", recipe.category);
  setText("[data-recipe-category]", recipe.category);
  setText("[data-recipe-title]", recipe.title);
  setText("[data-recipe-description]", recipe.description);
  setText("[data-prep-time]", recipe.prepTime);
  setText("[data-cook-time]", recipe.cookTime);
  setText("[data-servings]", recipe.servings);
  setText("[data-difficulty]", recipe.difficulty);
  setText("[data-nutrition-calories]", recipe.nutrition.calories);
  setText("[data-nutrition-protein]", recipe.nutrition.protein);
  setText("[data-nutrition-carbs]", recipe.nutrition.carbs);
  setText("[data-nutrition-fat]", recipe.nutrition.fat);

  const recipeImage = document.querySelector("[data-recipe-image]");
  if (recipeImage) {
    recipeImage.src = recipe.image;
    recipeImage.alt = recipe.alt;
  }

  const breadcrumbCategoryLink = document.querySelector("[data-breadcrumb-category-link]");
  if (breadcrumbCategoryLink) {
    breadcrumbCategoryLink.href = "categories.html";
  }

  setHtml(
    "[data-ingredient-list]",
    recipe.ingredients.map((ingredient) => `<li>${ingredient}</li>`).join("")
  );
  setHtml(
    "[data-instruction-list]",
    recipe.instructions.map((step) => `<li class="instruction-step">${step}</li>`).join("")
  );
  setHtml(
    "[data-related-list]",
    relatedCatalog
      .map(
        ([slug, relatedRecipe]) => `
          <a class="related-card" href="${getRecipeHref(slug)}">
            <img
              class="related-image"
              src="${relatedRecipe.image}"
              alt="${relatedRecipe.alt}"
            />
            <div>
              <h4 class="related-title">${relatedRecipe.title}</h4>
              <span class="meta-badge">${relatedRecipe.cookTime}</span>
            </div>
          </a>
        `
      )
      .join("")
  );

  const parseDurationMinutes = (label) => {
    const hours = Number(label.match(/(\d+)\s*hr/)?.[1] || 0);
    const minutes = Number(label.match(/(\d+)\s*min/)?.[1] || 0);
    return hours * 60 + minutes;
  };

  const toIsoDuration = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const hourPart = hours ? `${hours}H` : "";
    const minutePart = remainingMinutes ? `${remainingMinutes}M` : "";
    return `PT${hourPart}${minutePart || (!hourPart ? "0M" : "")}`;
  };

  const setMetaContent = (attributeName, attributeValue, content) => {
    let element = document.querySelector(`meta[${attributeName}="${attributeValue}"]`);

    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attributeName, attributeValue);
      document.head.appendChild(element);
    }

    element.setAttribute("content", content);
  };

  const updateRecipeSeo = () => {
    const title = `${recipe.title} | Modish Menu`;
    const description = `${recipe.description} Includes prep time, cook time, servings, ingredients, instructions, and nutrition facts.`;
    const pinterestSaveUrl = new URL("https://www.pinterest.com/pin/create/button/");
    const prepMinutes = parseDurationMinutes(recipe.prepTime);
    const cookMinutes = parseDurationMinutes(recipe.cookTime);
    const recipeJsonLd = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      "@id": `${recipeAbsoluteUrl}#recipe`,
      mainEntityOfPage: recipeAbsoluteUrl,
      url: recipeAbsoluteUrl,
      name: recipe.title,
      description: recipe.description,
      image: [recipeImageAbsoluteUrl],
      author: {
        "@type": "Organization",
        name: "Modish Menu",
      },
      publisher: {
        "@type": "Organization",
        name: "Modish Menu",
      },
      datePublished: "2025-04-26",
      dateModified: "2026-05-02",
      prepTime: toIsoDuration(prepMinutes),
      cookTime: toIsoDuration(cookMinutes),
      totalTime: toIsoDuration(prepMinutes + cookMinutes),
      recipeYield: `${recipe.servings} servings`,
      recipeCategory: recipe.category,
      keywords: [recipe.category, recipe.difficulty, "Modish Menu recipe"].join(", "),
      recipeIngredient: recipe.ingredients,
      recipeInstructions: recipe.instructions.map((step, index) => ({
        "@type": "HowToStep",
        name: `Step ${index + 1}`,
        text: step.replace(/Â°F/g, " degrees F"),
      })),
      nutrition: {
        "@type": "NutritionInformation",
        calories: `${recipe.nutrition.calories} calories`,
        proteinContent: recipe.nutrition.protein,
        carbohydrateContent: recipe.nutrition.carbs,
        fatContent: recipe.nutrition.fat,
      },
    };

    document.title = title;

    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
    }

    canonicalLink.setAttribute("href", recipeAbsoluteUrl);

    setMetaContent("name", "description", description);
    setMetaContent("property", "og:type", "article");
    setMetaContent("property", "og:site_name", "Modish Menu");
    setMetaContent("property", "og:title", title);
    setMetaContent("property", "og:description", description);
    setMetaContent("property", "og:image", recipeImageAbsoluteUrl);
    setMetaContent("property", "og:url", recipeAbsoluteUrl);
    setMetaContent("property", "article:section", recipe.category);
    setMetaContent("name", "twitter:card", "summary_large_image");
    setMetaContent("name", "twitter:title", title);
    setMetaContent("name", "twitter:description", description);
    setMetaContent("name", "twitter:image", recipeImageAbsoluteUrl);

    pinterestSaveUrl.searchParams.set("url", recipeAbsoluteUrl);
    pinterestSaveUrl.searchParams.set("media", recipeImageAbsoluteUrl);
    pinterestSaveUrl.searchParams.set("description", title);

    document.querySelectorAll("[data-pinterest-save-link]").forEach((link) => {
      link.href = pinterestSaveUrl.href;
    });

    let jsonLdScript = document.querySelector("#recipe-json-ld");
    if (!jsonLdScript) {
      jsonLdScript = document.createElement("script");
      jsonLdScript.type = "application/ld+json";
      jsonLdScript.id = "recipe-json-ld";
      document.head.appendChild(jsonLdScript);
    }

    jsonLdScript.textContent = JSON.stringify(recipeJsonLd, null, 2);
  };

  updateRecipeSeo();

  const canonicalRecipeLinks = document.querySelectorAll("[data-current-recipe-link]");
  canonicalRecipeLinks.forEach((link) => {
    link.href = recipeUrl;
  });
}
