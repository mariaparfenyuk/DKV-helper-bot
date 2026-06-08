/**
 * Вычисляет расстояние между двумя точками на Земле в километрах (Формула гаверсинусов)
 * @param {number} lat1 - Широта пользователя
 * @param {number} lon1 - Долгота пользователя
 * @param {number} lat2 - Широта заправки
 * @param {number} lon2 - Долгота заправки
 * @returns {number} - Расстояние в км, округленное до 1 знака после запятой
 */
const getDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;

  const R = 6371; // Радиус Земли в километрах
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 10) / 10; // Округляем до 0.1 км
};

module.exports = { getDistance };