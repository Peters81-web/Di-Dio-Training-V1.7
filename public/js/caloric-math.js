/**
 * caloric-math.js
 * Calcoli per il "Bilancio Calorico":
 *   - BMR (Basal Metabolic Rate) via formula Mifflin-St Jeor 1990
 *     (gold standard scientifica per adulti 18-65)
 *   - TDEE (Total Daily Energy Expenditure) = BMR × activity factor
 *   - Bilancio = TDEE_base + workout_kcal − intake_kcal
 *
 * Strategia usata in questa app: "A" = activity factor SEDENTARIO 1.2 +
 * somma esplicita delle calorie workout. Evita doppio conteggio e premia
 * gli allenamenti extra rispetto a un giorno tipico.
 *
 * Nessuna dipendenza da DOM/Supabase. Funzioni pure, testabili in isolamento.
 * Esposto come window.CaloricMath (no ES modules per coerenza col resto).
 */
(function () {
  'use strict';

  // ── ACTIVITY FACTORS ────────────────────────────────────────────
  // Riferimento standard internazionale (FAO/WHO 1985 + revisioni)
  const ACTIVITY_FACTORS = {
    sedentary:  { factor: 1.2,   label: 'Sedentario',         hint: 'Lavoro d\'ufficio, nessuno sport extra' },
    light:      { factor: 1.375, label: 'Leggermente attivo', hint: '1-3 allenamenti/settimana' },
    moderate:   { factor: 1.55,  label: 'Moderatamente attivo', hint: '3-5 allenamenti/settimana' },
    very:       { factor: 1.725, label: 'Molto attivo',       hint: '6-7 allenamenti/settimana' },
    extreme:    { factor: 1.9,   label: 'Estremamente attivo', hint: '2 allenamenti/giorno, lavoro fisico' }
  };

  // ── ETÀ da data di nascita (formato YYYY-MM-DD o ISO date) ──────
  function ageFromBirthdate(birthdate) {
    if (!birthdate) return null;
    const today = new Date();
    const bd = new Date(String(birthdate).slice(0, 10));
    if (isNaN(bd.getTime())) return null;
    let age = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
    return age >= 0 ? age : null;
  }

  // ── BMR Mifflin-St Jeor ─────────────────────────────────────────
  // gender: 'maschio' | 'femmina' (lowercase italiano, come in DB)
  //         qualsiasi altro valore → usa media dei due (compromesso onesto)
  // Tutti gli input devono essere numeri positivi validi.
  function calcBMR({ weight, height, age, gender }) {
    if (![weight, height, age].every(v => typeof v === 'number' && v > 0)) return null;

    const base = 10 * weight + 6.25 * height - 5 * age;
    const g = String(gender || '').toLowerCase();

    if (g === 'maschio' || g === 'm' || g === 'male' || g === 'uomo') {
      return Math.round(base + 5);
    }
    if (g === 'femmina' || g === 'f' || g === 'female' || g === 'donna') {
      return Math.round(base - 161);
    }
    // Gender ignoto: media (errore < 5% rispetto ai valori reali)
    return Math.round(base - 78);
  }

  // ── TDEE = BMR × activity factor ────────────────────────────────
  function calcTDEE(bmr, activityKey) {
    if (typeof bmr !== 'number' || bmr <= 0) return null;
    const entry = ACTIVITY_FACTORS[activityKey] || ACTIVITY_FACTORS.sedentary;
    return Math.round(bmr * entry.factor);
  }

  // ── Bilancio giornaliero ────────────────────────────────────────
  // Strategia A: TDEE base sedentario + workout calories esplicite.
  // Se intake non fornito, restituisce il "deficit potenziale": cioè
  // assumendo che l'utente mangi pari al suo TDEE base, ogni kcal
  // bruciata col workout diventa deficit.
  function calcBalance({ tdeeBase, workoutKcal = 0, intakeKcal = null }) {
    if (typeof tdeeBase !== 'number' || tdeeBase <= 0) return null;
    const expenditure = tdeeBase + (workoutKcal || 0);

    if (intakeKcal == null) {
      // Deficit potenziale (assumendo intake = tdeeBase)
      return {
        expenditure: expenditure,
        intake: null,
        balance: -(workoutKcal || 0), // negativo = deficit
        mode: 'potential'
      };
    }
    return {
      expenditure: expenditure,
      intake: intakeKcal,
      balance: intakeKcal - expenditure, // negativo = deficit
      mode: 'actual'
    };
  }

  // ── Validazione età per uso della formula ───────────────────────
  // Mifflin-St Jeor è validato 18-65. Fuori range avvertiamo l'utente.
  function ageReliability(age) {
    if (age == null) return { ok: false, reason: 'missing' };
    if (age < 15) return { ok: false, reason: 'minor', message: 'Le stime non sono affidabili sotto i 15 anni (servirebbero formule pediatriche).' };
    if (age < 18) return { ok: true,  reason: 'teen',  message: 'Stima approssimativa per età < 18 anni.' };
    if (age > 65) return { ok: true,  reason: 'elder', message: 'Stima leggermente sovrastimata oltre i 65 anni (formula tende a +5/10%).' };
    return { ok: true, reason: 'adult' };
  }

  // ── Funzione comoda end-to-end ──────────────────────────────────
  // Input: profile incompleto/completo, ritorna oggetto pronto per la UI.
  // Esempio di profile: { gender, birthdate, weight, height, activity }
  function computeAll(profile, workoutKcalToday) {
    const age = ageFromBirthdate(profile.birthdate);
    const missing = [];
    if (!profile.gender)    missing.push('sesso');
    if (age == null)        missing.push('data di nascita');
    if (!profile.weight)    missing.push('peso');
    if (!profile.height)    missing.push('altezza');

    if (missing.length) {
      return { ok: false, missing: missing };
    }

    const bmr = calcBMR({
      weight: profile.weight,
      height: profile.height,
      age: age,
      gender: profile.gender
    });
    const activityKey = profile.activity || 'sedentary';
    const tdeeBase = calcTDEE(bmr, activityKey);
    const balance = calcBalance({ tdeeBase: tdeeBase, workoutKcal: workoutKcalToday });
    const activityInfo = ACTIVITY_FACTORS[activityKey] || ACTIVITY_FACTORS.sedentary;

    return {
      ok: true,
      age: age,
      bmr: bmr,
      tdeeBase: tdeeBase,
      activityKey: activityKey,
      activityFactor: activityInfo.factor,
      activityLabel: activityInfo.label,
      workoutKcal: workoutKcalToday || 0,
      totalExpenditure: balance.expenditure,
      potentialDeficit: balance.balance, // negativo = deficit
      reliability: ageReliability(age)
    };
  }

  // ── Esporta ─────────────────────────────────────────────────────
  window.CaloricMath = {
    ageFromBirthdate: ageFromBirthdate,
    calcBMR: calcBMR,
    calcTDEE: calcTDEE,
    calcBalance: calcBalance,
    ageReliability: ageReliability,
    computeAll: computeAll,
    ACTIVITY_FACTORS: ACTIVITY_FACTORS
  };
})();
