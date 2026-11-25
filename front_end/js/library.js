import { get, post } from "./api.js";
import {
  attachLiveValidation,
  validateForm,
  applyServerErrors,
  clearErrors,
  showFieldError,
} from "./validation.js";

const PAGE_SIZE = 9;
const MAX_IMAGE_DIMENSION = 800;
const MAX_IMAGE_LENGTH = 1_000_000; // matches the server-side limit (data URL characters)
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FLIP_MS = 700;

const LOGIN_PAGE = "index.html";

const $ = (id) => document.getElementById(id);
const form = $("card-form");
const searchForm = $("search-form");
const book = $("book");
const template = $("card-template");
const imageInput = form.elements.image;

let currentPage = 1;
let totalPages = 1;
let filters = {};
let isBusy = false;
let editingId = null;
let cardsById = new Map();

// ---------- Auth ----------

const me = await get("/auth/me");
if (!me.ok) {
  location.href = LOGIN_PAGE;
} else {
  $("username").textContent = me.data.username;
}

$("logout").addEventListener("click", async () => {
  await post("/auth/logout");
  location.href = LOGIN_PAGE;
});

// ---------- Rendering ----------

function buildPage(cards) {
  const leaf = document.createElement("div");
  leaf.className = "leaf";
  const grid = document.createElement("div");
  grid.className = "grid";

  for (const card of cards) {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector(".card");
    article.dataset.id = card._id;

    const img = fragment.querySelector("img");
    if (card.image) {
      img.src = card.image;
      img.alt = card.name ?? "";
      img.hidden = false;
    }

    fragment.querySelector(".name").textContent = card.name ?? "";
    fragment.querySelector(".rarity").textContent = card.rarity ?? "";
    fragment.querySelector(".element").textContent = card.element ?? "";
    fragment.querySelector(".set").textContent = card.setRelease ?? "";
    grid.append(fragment);
  }

  // Fill the rest of the page with empty pockets; the first one is a "+" shortcut to the form.
  for (let i = cards.length; i < PAGE_SIZE; i++) {
    const pocket = document.createElement("div");
    pocket.className = "pocket";
    const slot = document.createElement("div");
    slot.className = "slot";
    if (i === cards.length) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "add-slot";
      add.textContent = "+";
      add.setAttribute("aria-label", "Add a card");
      slot.append(add);
    }
    pocket.append(slot);
    grid.append(pocket);
  }

  leaf.append(grid);
  return leaf;
}

function afterTransition(element) {
  return new Promise((resolve) => {
    const finish = () => {
      element.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === element && event.propertyName === "transform") finish();
    };
    const timer = setTimeout(finish, FLIP_MS + 150);
    element.addEventListener("transitionend", onEnd);
  });
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// direction: "next" | "prev" | null (null replaces the page with no animation)
async function showLeaf(newLeaf, direction) {
  const oldLeaf = book.querySelector(".leaf");

  if (!oldLeaf || !direction || prefersReducedMotion()) {
    book.replaceChildren(newLeaf);
    return;
  }

  if (direction === "next") {
    // New page waits underneath; the old page turns away like a page of a book.
    oldLeaf.style.zIndex = "2";
    newLeaf.style.zIndex = "1";
    book.append(newLeaf);
    oldLeaf.classList.add("flipped");
    await afterTransition(oldLeaf);
    oldLeaf.remove();
    newLeaf.style.zIndex = "";
  } else {
    // New page starts turned over on top and swings back onto the old page.
    oldLeaf.style.zIndex = "1";
    newLeaf.style.zIndex = "2";
    newLeaf.classList.add("flipped", "no-anim");
    book.append(newLeaf);
    void newLeaf.offsetWidth; // apply the starting state before animating
    newLeaf.classList.remove("no-anim");
    newLeaf.classList.remove("flipped");
    await afterTransition(newLeaf);
    oldLeaf.remove();
    newLeaf.style.zIndex = "";
  }
}

function updateControls(total) {
  $("page-count").textContent = `${currentPage} of ${totalPages}`;
  $("prev-page").disabled = currentPage <= 1;
  $("next-page").disabled = currentPage >= totalPages;
  $("library-message").textContent = total === 0 ? "No cards found." : "";
}

async function fetchPage(page) {
  const params = new URLSearchParams({ page, limit: PAGE_SIZE, ...filters });
  return get(`/cards?${params}`);
}

async function loadPage(page, direction = null) {
  if (isBusy) return;
  isBusy = true;
  try {
    let result = await fetchPage(page);
    if (result.status === 401) {
      location.href = LOGIN_PAGE;
      return;
    }
    if (!result.ok) {
      $("library-message").textContent = "Could not load cards. Please try again.";
      return;
    }

    let total = Number(result.headers.get("X-Total-Count")) || 0;
    totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    // The page may no longer exist (e.g. last card on it was deleted).
    if (page > totalPages) {
      page = totalPages;
      result = await fetchPage(page);
      if (!result.ok) return;
      total = Number(result.headers.get("X-Total-Count")) || 0;
    }

    currentPage = page;
    cardsById = new Map(result.data.map((card) => [card._id, card]));
    updateControls(total);
    await showLeaf(buildPage(result.data), direction);
  } finally {
    isBusy = false;
  }
}

// ---------- Paging and search ----------

$("next-page").addEventListener("click", () => {
  if (currentPage < totalPages) loadPage(currentPage + 1, "next");
});
$("prev-page").addEventListener("click", () => {
  if (currentPage > 1) loadPage(currentPage - 1, "prev");
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  filters = {};
  for (const [key, value] of new FormData(searchForm)) {
    const text = String(value).trim();
    if (text) filters[key] = text;
  }
  loadPage(1);
});

searchForm.addEventListener("reset", () => {
  filters = {};
  loadPage(1);
});

// ---------- Card form: image handling ----------

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file could not be read as an image."));
    img.src = src;
  });
}

// Downscales large images with the Canvas API so the stored data URL stays small.
async function prepareImage(file) {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));

  if (scale === 1 && original.length <= MAX_IMAGE_LENGTH) return original;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff"; // JPEG has no transparency
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);

  const result = canvas.toDataURL("image/jpeg", 0.8);
  if (result.length > MAX_IMAGE_LENGTH) throw new Error("Image is too large. Please choose a smaller one.");
  return result;
}

// Registered before the image-specific listener below so that the generic
// "clear custom message" step runs first and the image check runs after it.
attachLiveValidation(form);

imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  imageInput.setCustomValidity("");
  if (file && !file.type.startsWith("image/")) {
    imageInput.setCustomValidity("Please choose an image file.");
  } else if (file && file.size > MAX_FILE_BYTES) {
    imageInput.setCustomValidity("Image is too large (10 MB maximum).");
  }
  showFieldError(imageInput);

  // Choosing a new image replaces any "remove" request.
  if (file) form.elements.removeImage.checked = false;
  updatePreview();
});

// ---------- Card form: image preview (click-to-add placeholder) ----------

const preview = $("image-preview");
const placeholder = $("image-placeholder");
let previewUrl = null; // object URL for a freshly chosen file
let currentImage = null; // data URL already stored on the card being edited

function updatePreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  const file = imageInput.files[0];
  let src = null;
  if (file && file.type.startsWith("image/")) {
    previewUrl = URL.createObjectURL(file);
    src = previewUrl;
  } else if (currentImage && !form.elements.removeImage.checked) {
    src = currentImage;
  }

  preview.hidden = !src;
  placeholder.hidden = Boolean(src);
  if (src) preview.src = src;
  else preview.removeAttribute("src");
}

// A file the browser cannot draw falls back to the placeholder.
preview.addEventListener("error", () => {
  preview.hidden = true;
  placeholder.hidden = false;
});

form.elements.removeImage.addEventListener("change", () => {
  if (form.elements.removeImage.checked) imageInput.value = ""; // drop any newly chosen file
  imageInput.setCustomValidity("");
  showFieldError(imageInput);
  updatePreview();
});

// ---------- Card form: add / edit ----------

function setEditMode(card) {
  editingId = card?._id ?? null;
  currentImage = card?.image ?? null;
  $("form-title").textContent = card ? "Edit the Card" : "Add a Card";
  $("submit-button").textContent = card ? "Apply Changes" : "Add To Your Binder!";
  $("cancel-edit").hidden = !card;
  $("remove-image-row").hidden = !card?.image;
  updatePreview();
}

function resetForm() {
  form.reset();
  clearErrors(form);
  $("card-form-message").textContent = "";
  setEditMode(null);
}

function startEdit(id) {
  const card = cardsById.get(id);
  if (!card) return;

  resetForm();
  form.elements.id.value = card._id;
  form.elements.name.value = card.name ?? "";
  form.elements.rarity.value = card.rarity ?? "";
  form.elements.element.value = card.element ?? "";
  form.elements.setRelease.value = card.setRelease ?? "";
  setEditMode(card);

  form.scrollIntoView();
  form.elements.name.focus();
}

$("cancel-edit").addEventListener("click", resetForm);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("card-form-message");
  message.textContent = "";
  if (!validateForm(form)) return;

  const button = $("submit-button");
  button.disabled = true;
  try {
    const body = {
      name: form.elements.name.value,
      rarity: form.elements.rarity.value,
      element: form.elements.element.value,
      setRelease: form.elements.setRelease.value,
    };

    const file = imageInput.files[0];
    if (file) {
      try {
        body.image = await prepareImage(file);
      } catch (error) {
        imageInput.setCustomValidity(error.message);
        showFieldError(imageInput);
        imageInput.focus();
        return;
      }
    }
    if (editingId && form.elements.removeImage.checked) body.removeImage = true;

    const wasEditing = Boolean(editingId);
    const result = wasEditing
      ? await post(`/cards/${editingId}/update`, body)
      : await post("/cards", body);

    if (result.ok) {
      resetForm();
      await loadPage(wasEditing ? currentPage : 1);
      return;
    }
    if (result.status === 401) {
      location.href = LOGIN_PAGE;
      return;
    }
    const shown = result.data?.errors && applyServerErrors(form, result.data.errors);
    if (!shown) message.textContent = result.data?.error ?? "Could not save the card. Please try again.";
  } catch {
    message.textContent = "Could not reach the server. Please try again.";
  } finally {
    button.disabled = false;
  }
});

// ---------- Edit / delete buttons on library entries ----------

book.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  // The "+" in an empty pocket jumps to the (blank) add form.
  if (button.classList.contains("add-slot")) {
    resetForm();
    form.scrollIntoView({ behavior: "smooth" });
    form.elements.name.focus({ preventScroll: true });
    return;
  }

  const article = event.target.closest(".card");
  if (!article) return;
  const id = article.dataset.id;

  if (button.classList.contains("edit")) {
    startEdit(id);
  } else if (button.classList.contains("delete")) {
    if (!confirm("Delete this card?")) return;
    const result = await post(`/cards/${id}/delete`);
    if (result.status === 401) {
      location.href = LOGIN_PAGE;
      return;
    }
    if (!result.ok) {
      $("library-message").textContent = result.data?.error ?? "Could not delete the card.";
      return;
    }
    if (editingId === id) resetForm();
    await loadPage(currentPage);
  }
});

// ---------- Start ----------

if (me.ok) await loadPage(1);
