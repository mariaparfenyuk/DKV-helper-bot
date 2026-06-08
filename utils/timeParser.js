const i18n = require('../i18n');

const getTxtByLang = (lang, key) => {
  return i18n[lang]?.[key] || i18n['en']?.[key] || `[${key}]`;
};

/**
 * Адаптированный парсер времени под реальные поля API Франции
 * @param {Object} station - объект заправки целиком
 * @param {string} lang - язык
 */
const parseFrenchHours = (station, lang = 'ru') => {
  if (!station) return getTxtByLang(lang, 'time_no_data');

  // 1. Проверяем флаг круглосуточного автомата 24/24
  if (station.horaires_automate_24_24 === 'Oui') {
    return getTxtByLang(lang, 'time_24_7'); // 🟢 Круглосуточно 24/7
  }

  // 2. Если есть детальный массив (на случай, если попадется заполненный)
  if (station.horaires?.jour || station.horaires_jour) {
    const jour = station.horaires?.jour || station.horaires_jour;
    if (Array.isArray(jour)) {
      const currentDayIdx = new Date().getDay();
      const apiDayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
      const todayName = apiDayNames[currentDayIdx];
      const todayData = jour.find(j => j.nom === todayName || String(j['@id']) === String(currentDayIdx === 0 ? 7 : currentDayIdx));

      if (todayData) {
        if (todayData.ferme === '1' || todayData['@ferme'] === '1' || todayData.ferme === true) {
          return getTxtByLang(lang, 'time_closed_today');
        }
        const opening = todayData.horaire?.ouverture || todayData['@ouverture'];
        const closing = todayData.horaire?.fermeture || todayData['@fermeture'];
        if (opening && closing) {
          const formatTime = (t) => String(t).replace('.', ':');
          return getTxtByLang(lang, 'time_today_format').replace('{open}', formatTime(opening)).replace('{close}', formatTime(closing));
        }
      }
    }
  }

  // 3. Дефолтный ответ, если автомат "Non", а расписания внутри нет
  return getTxtByLang(lang, 'time_by_schedule'); // 🕒 Время работы: по графику АЗС
};

module.exports = {
  parseFrenchHours
};