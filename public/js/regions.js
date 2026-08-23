/* Region-aware marketplaces. Every deal skill asks marketCards() for the
   sites that matter where the user lives; universal (Google-based) links
   stay in skills.js. Region is a profile setting, auto-detected from the
   browser locale on first run. */
import { store } from './store.js';

const enc = encodeURIComponent;
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');

export const REGIONS = { us: 'United States', in: 'India', uk: 'United Kingdom', ca: 'Canada', au: 'Australia' };

export function detectRegion() {
  const cc = (navigator.language || '').toLowerCase().split('-')[1];
  return cc === 'gb' ? 'uk' : (REGIONS[cc] ? cc : 'us');
}

export function getRegion() {
  return store.get('profile', {}).region || detectRegion();
}

/* One entry per skill; per-region card lists fall back to `us`.
   Card shape matches skills.js: { t: title, s: subtitle, url }. */
const M = {
  rent: {
    us: (s) => [
      { t: 'Zillow Rentals', s: 'Largest inventory, price cuts flagged', url: `https://www.zillow.com/homes/for_rent/${enc(s.city)}_rb/` },
      { t: 'Apartments.com', s: 'Filter by move-in specials', url: `https://www.apartments.com/${slug(s.city)}/` },
      { t: 'HotPads', s: 'Map-first search, price history', url: `https://hotpads.com/${slug(s.city)}/apartments-for-rent` },
    ],
    in: (s) => [
      { t: 'NoBroker', s: 'Zero brokerage — direct from owners', url: `https://www.nobroker.in/property/rent/${slug(s.city)}` },
      { t: 'MagicBricks', s: 'Biggest listing base, price trends', url: `https://www.magicbricks.com/property-for-rent/residential-real-estate?cityName=${enc(s.city)}` },
      { t: '99acres', s: 'Owner listings, locality reviews', url: `https://www.99acres.com/search/property/rent/${slug(s.city)}` },
    ],
    uk: (s) => [
      { t: 'Rightmove', s: 'Biggest UK inventory', url: `https://www.rightmove.co.uk/property-to-rent/search.html?searchLocation=${enc(s.city)}` },
      { t: 'Zoopla', s: 'Price history & area stats', url: `https://www.zoopla.co.uk/to-rent/property/${slug(s.city)}/` },
      { t: 'SpareRoom', s: 'Rooms & flatshares', url: `https://www.spareroom.co.uk/flatshare/?search=${enc(s.city)}` },
    ],
    ca: (s) => [
      { t: 'Rentals.ca', s: 'Canada-wide listings', url: `https://rentals.ca/${slug(s.city)}` },
      { t: 'PadMapper', s: 'Map-first search', url: `https://www.padmapper.com/apartments/${slug(s.city)}` },
      { t: 'Kijiji', s: 'Private landlords, negotiable', url: `https://www.kijiji.ca/b-apartments-condos/${slug(s.city)}/k0c37l0` },
    ],
    au: (s) => [
      { t: 'realestate.com.au', s: 'Biggest AU inventory', url: `https://www.realestate.com.au/rent/in-${slug(s.city)}/list-1` },
      { t: 'Domain', s: 'Inspection times & price guides', url: `https://www.domain.com.au/rent/${slug(s.city)}/` },
      { t: 'Flatmates', s: 'Rooms & shares', url: `https://flatmates.com.au/${slug(s.city)}` },
    ],
  },

  hotel: {
    us: () => [],
    in: (s) => [
      { t: 'MakeMyTrip', s: 'Domestic deals & coupon stacking', url: `https://www.makemytrip.com/hotels/hotel-listing/?city=${enc(s.city)}` },
      { t: 'Agoda', s: 'Often cheapest in Asia', url: `https://www.agoda.com/search?textToSearch=${enc(s.city)}` },
    ],
  },

  flight: {
    us: () => [],
    in: (s) => [
      { t: 'ixigo', s: 'Fare alerts + price predictions', url: 'https://www.ixigo.com/flights' },
      { t: 'MakeMyTrip', s: 'Bank-card instant discounts', url: 'https://www.makemytrip.com/flights/' },
    ],
  },

  shopping: {
    us: (s) => [
      { t: 'Slickdeals', s: 'Community-vetted discounts & coupons', url: `https://slickdeals.net/newsearch.php?q=${enc(s.item)}&searcharea=deals` },
      { t: 'CamelCamelCamel', s: 'Amazon price history & drop alerts', url: `https://camelcamelcamel.com/search?sq=${enc(s.item)}` },
      { t: 'eBay', s: 'Refurb & open-box, often 20–40% off', url: `https://www.ebay.com/sch/i.html?_nkw=${enc(s.item)}` },
    ],
    in: (s) => [
      { t: 'Flipkart', s: 'Compare vs Amazon before buying', url: `https://www.flipkart.com/search?q=${enc(s.item)}` },
      { t: 'Amazon.in', s: 'Lightning deals & bank offers', url: `https://www.amazon.in/s?k=${enc(s.item)}` },
      { t: 'DesiDime', s: 'Community deals & coupons', url: `https://www.desidime.com/search?keyword=${enc(s.item)}` },
    ],
    uk: (s) => [
      { t: 'hotukdeals', s: 'Community-vetted UK deals', url: `https://www.hotukdeals.com/search?q=${enc(s.item)}` },
      { t: 'eBay UK', s: 'Refurb & open-box savings', url: `https://www.ebay.co.uk/sch/i.html?_nkw=${enc(s.item)}` },
    ],
    ca: (s) => [
      { t: 'RedFlagDeals', s: 'Canada deal community', url: `https://www.redflagdeals.com/search/#!/q=${enc(s.item)}` },
      { t: 'eBay Canada', s: 'Refurb & open-box savings', url: `https://www.ebay.ca/sch/i.html?_nkw=${enc(s.item)}` },
    ],
    au: (s) => [
      { t: 'OzBargain', s: 'Australia deal community', url: `https://www.ozbargain.com.au/search/node/${enc(s.item)}` },
      { t: 'eBay Australia', s: 'Refurb & open-box savings', url: `https://www.ebay.com.au/sch/i.html?_nkw=${enc(s.item)}` },
    ],
  },

  insurance: {
    us: (s) => [
      { t: 'HealthCare.gov', s: 'Official marketplace — preview real prices', url: `https://www.healthcare.gov/see-plans/#/${enc(s.zip || '')}` },
      { t: 'KFF Subsidy Calculator', s: 'Estimate your discount in 1 minute', url: 'https://www.kff.org/interactive/subsidy-calculator/' },
      { t: 'Medicaid Eligibility', s: 'Free/low-cost coverage check', url: 'https://www.healthcare.gov/medicaid-chip/getting-medicaid-chip/' },
    ],
    in: () => [
      { t: 'Policybazaar', s: 'Compare every insurer at once', url: 'https://www.policybazaar.com/health-insurance/health-insurance-india/' },
      { t: 'Ayushman Bharat (PM-JAY)', s: '₹5 lakh free cover — check eligibility', url: 'https://beneficiary.nha.gov.in/' },
      { t: 'IRDAI insurer list', s: 'Verify any insurer is licensed', url: 'https://irdai.gov.in/' },
    ],
    uk: () => [
      { t: 'NHS services', s: 'Register with a GP — free care', url: 'https://www.nhs.uk/nhs-services/gps/how-to-register-with-a-gp-surgery/' },
      { t: 'MoneySuperMarket', s: 'Compare private health cover', url: 'https://www.moneysupermarket.com/health-insurance/' },
    ],
    ca: () => [
      { t: 'Provincial health plans', s: 'Register for your province’s coverage', url: 'https://www.canada.ca/en/health-canada/services/health-care-system/canada-health-care-system-medicare/provincial-territorial-health-care-resources.html' },
      { t: 'PolicyAdvisor', s: 'Compare supplemental cover', url: 'https://www.policyadvisor.com/health-insurance/' },
    ],
    au: () => [
      { t: 'PrivateHealth.gov.au', s: 'Official comparison — every policy', url: 'https://www.privatehealth.gov.au/' },
      { t: 'Medicare', s: 'Enrol / check your coverage', url: 'https://www.servicesaustralia.gov.au/medicare' },
    ],
  },

  appointment: {
    us: (s, profile) => [
      { t: 'Zocdoc', s: `Find a ${s.specialty} with open slots`, url: `https://www.zocdoc.com/search?address=${enc(profile.city || '')}&text=${enc(s.specialty)}` },
    ],
    in: (s) => [
      { t: 'Practo', s: `Book a ${s.specialty} online`, url: `https://www.practo.com/search/doctors?q=${enc(s.specialty)}` },
      { t: 'Apollo 24|7', s: 'Hospital network appointments', url: `https://www.apollo247.com/specialties` },
    ],
    uk: () => [
      { t: 'NHS appointments', s: 'Book via your GP surgery', url: 'https://www.nhs.uk/nhs-services/gps/gp-appointments-and-bookings/' },
    ],
  },

  reservation: {
    us: (s) => [
      { t: 'OpenTable', s: `Book "${s.venue}" online`, url: `https://www.opentable.com/s?term=${enc(s.venue)}&covers=${s.size}` },
    ],
    in: (s) => [
      { t: 'Zomato', s: `"${s.venue}" — menus, ratings, booking`, url: `https://www.zomato.com/search?q=${enc(s.venue)}` },
      { t: 'EazyDiner', s: 'Prime slots + up to 50% off deals', url: `https://www.eazydiner.com/search?q=${enc(s.venue)}` },
    ],
    uk: (s) => [
      { t: 'OpenTable UK', s: `Book "${s.venue}" online`, url: `https://www.opentable.co.uk/s?term=${enc(s.venue)}&covers=${s.size}` },
      { t: 'SquareMeal', s: 'Reviews + set-menu deals', url: `https://www.squaremeal.co.uk/search?q=${enc(s.venue)}` },
    ],
  },

  groceries: {
    us: (s) => [
      { t: 'Instacart', s: 'Compare stores, same-day delivery', url: `https://www.instacart.com/store/s?k=${enc(s.items)}` },
      { t: 'Walmart', s: 'Usually the lowest base prices', url: `https://www.walmart.com/search?q=${enc(s.items)}` },
    ],
    in: (s) => [
      { t: 'BigBasket', s: 'Widest range, smart-basket savings', url: `https://www.bigbasket.com/ps/?q=${enc(s.items)}` },
      { t: 'Blinkit', s: '10-minute delivery', url: `https://blinkit.com/s/?q=${enc(s.items)}` },
      { t: 'JioMart', s: 'Often cheapest for staples', url: `https://www.jiomart.com/search/${enc(s.items)}` },
    ],
    uk: (s) => [
      { t: 'Tesco', s: 'Clubcard prices', url: `https://www.tesco.com/groceries/en-GB/search?query=${enc(s.items)}` },
      { t: 'Sainsbury’s', s: 'Nectar prices', url: `https://www.sainsburys.co.uk/gol-ui/SearchResults/${enc(s.items)}` },
    ],
    ca: (s) => [
      { t: 'Walmart Canada', s: 'Lowest base prices', url: `https://www.walmart.ca/search?q=${enc(s.items)}` },
      { t: 'Instacart', s: 'Compare stores, same-day delivery', url: `https://www.instacart.ca/store/s?k=${enc(s.items)}` },
    ],
    au: (s) => [
      { t: 'Woolworths', s: 'Weekly specials', url: `https://www.woolworths.com.au/shop/search/products?searchTerm=${enc(s.items)}` },
      { t: 'Coles', s: 'Half-price specials rotate weekly', url: `https://www.coles.com.au/search?q=${enc(s.items)}` },
    ],
  },

  rides: {
    us: () => [{ t: 'Lyft', s: 'Compare vs Uber before booking', url: 'https://www.lyft.com/' }],
    in: () => [
      { t: 'Ola', s: 'Compare vs Uber before booking', url: 'https://book.olacabs.com/' },
      { t: 'Rapido', s: 'Bike taxis — cheapest short hops', url: 'https://rapido.bike/' },
    ],
  },

  jobs: {
    us: (s) => [
      { t: 'Indeed', s: 'Most listings, easy-apply filter', url: `https://www.indeed.com/jobs?q=${enc(s.role)}&l=${enc(s.city)}` },
    ],
    in: (s) => [
      { t: 'Naukri', s: 'India’s biggest job board', url: `https://www.naukri.com/${slug(s.role)}-jobs-in-${slug(s.city)}` },
      { t: 'Indeed India', s: 'Easy-apply filter', url: `https://in.indeed.com/jobs?q=${enc(s.role)}&l=${enc(s.city)}` },
    ],
    uk: (s) => [
      { t: 'Reed', s: 'UK-wide listings', url: `https://www.reed.co.uk/jobs/${slug(s.role)}-jobs-in-${slug(s.city)}` },
      { t: 'Indeed UK', s: 'Easy-apply filter', url: `https://uk.indeed.com/jobs?q=${enc(s.role)}&l=${enc(s.city)}` },
    ],
    ca: (s) => [
      { t: 'Job Bank', s: 'Official — includes wage data', url: `https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=${enc(s.role)}&locationstring=${enc(s.city)}` },
      { t: 'Indeed Canada', s: 'Easy-apply filter', url: `https://ca.indeed.com/jobs?q=${enc(s.role)}&l=${enc(s.city)}` },
    ],
    au: (s) => [
      { t: 'SEEK', s: 'Australia’s biggest job board', url: `https://www.seek.com.au/${slug(s.role)}-jobs/in-${slug(s.city)}` },
      { t: 'Indeed Australia', s: 'Easy-apply filter', url: `https://au.indeed.com/jobs?q=${enc(s.role)}&l=${enc(s.city)}` },
    ],
  },

  meds: {
    us: (s) => [
      { t: 'GoodRx', s: 'Coupons cut 50–80% at checkout', url: `https://www.goodrx.com/search?query=${enc(s.drug)}` },
      { t: 'SingleCare', s: 'Second coupon source — compare', url: `https://www.singlecare.com/search?query=${enc(s.drug)}` },
      { t: 'CostPlusDrugs', s: 'Mark Cuban’s at-cost pharmacy', url: `https://costplusdrugs.com/medications/search/?q=${enc(s.drug)}` },
    ],
    in: (s) => [
      { t: 'Tata 1mg', s: 'Compare + substitute generics', url: `https://www.1mg.com/search/all?name=${enc(s.drug)}` },
      { t: 'PharmEasy', s: 'Recurring-order discounts', url: `https://pharmeasy.in/search/all?name=${enc(s.drug)}` },
      { t: 'Netmeds', s: 'First-order coupons', url: `https://www.netmeds.com/catalogsearch/result/${enc(s.drug)}/all` },
    ],
    uk: (s) => [
      { t: 'NHS medicines A-Z', s: 'Free/fixed-charge on prescription', url: `https://www.nhs.uk/medicines/` },
      { t: 'Chemist4U', s: 'Compare private prices', url: `https://www.chemist-4-u.com/search/?q=${enc(s.drug)}` },
    ],
    au: (s) => [
      { t: 'Chemist Warehouse', s: 'Usually the cheapest chain', url: `https://www.chemistwarehouse.com.au/search?searchtext=${enc(s.drug)}` },
      { t: 'PBS', s: 'Check the subsidised price', url: `https://www.pbs.gov.au/pbs/search?term=${enc(s.drug)}` },
    ],
  },

  usedcar: {
    us: (s) => [
      { t: 'CarGurus', s: 'Deal ratings vs market price', url: `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?searchText=${enc(s.model)}` },
      { t: 'AutoTrader', s: 'Biggest dealer inventory', url: `https://www.autotrader.com/cars-for-sale/all-cars?keywordPhrases=${enc(s.model)}` },
      { t: 'CarMax', s: 'No-haggle, 30-day returns', url: `https://www.carmax.com/cars?search=${enc(s.model)}` },
    ],
    in: (s) => [
      { t: 'CarDekho', s: 'Inspected cars + price reports', url: `https://www.cardekho.com/used-cars${s.city ? '+in+' + slug(s.city) : ''}` },
      { t: 'Cars24', s: 'Fixed price, 7-day returns', url: `https://www.cars24.com/buy-used-cars${s.city ? '-' + slug(s.city) : ''}/` },
      { t: 'OLX', s: 'Private sellers — most negotiable', url: `https://www.olx.in/items/q-${slug(s.model)}` },
    ],
    uk: (s) => [
      { t: 'AutoTrader UK', s: 'Biggest UK inventory', url: `https://www.autotrader.co.uk/car-search?keywords=${enc(s.model)}` },
      { t: 'Motorway', s: 'Price-check before you buy', url: 'https://motorway.co.uk/' },
    ],
    ca: (s) => [
      { t: 'AutoTrader.ca', s: 'Biggest Canadian inventory', url: `https://www.autotrader.ca/cars/?kwd=${enc(s.model)}` },
    ],
    au: (s) => [
      { t: 'Carsales', s: 'Biggest AU inventory', url: `https://www.carsales.com.au/cars/?q=${enc(s.model)}` },
    ],
  },

  transfer: {
    us: (s) => [
      { t: 'Lyft', s: 'Compare against Uber', url: `https://lyft.com/ride?id=lyft&pickup%5Baddress%5D=${enc(s.from)}&destination%5Baddress%5D=${enc(s.to)}` },
      { t: 'Blacklane', s: 'Pre-booked private chauffeur', url: 'https://www.blacklane.com/en/booking/' },
      { t: 'SuperShuttle / shared vans', s: 'Cheapest door-to-door', url: `https://www.google.com/search?q=${enc('airport shuttle ' + s.from + ' to ' + s.to)}` },
    ],
    in: (s) => [
      { t: 'Ola', s: 'Often cheaper than Uber locally', url: 'https://book.olacabs.com/' },
      { t: 'Rapido', s: 'Bike & auto — cheapest short hops', url: 'https://rapido.bike/' },
      { t: 'Savaari', s: 'Fixed-price outstation & airport cabs', url: `https://www.savaari.com/airport-taxi` },
      { t: 'Meru', s: 'Pre-book airport pickup', url: 'https://www.meru.in/' },
    ],
    uk: (s) => [
      { t: 'Bolt', s: 'Usually undercuts Uber', url: 'https://bolt.eu/en/cities/' },
      { t: 'FREENOW', s: 'Licensed black cabs', url: 'https://www.free-now.com/uk/' },
      { t: 'Addison Lee', s: 'Pre-booked cars, fixed fares', url: 'https://www.addisonlee.com/' },
      { t: 'National Express', s: 'Airport coaches — cheapest', url: `https://www.nationalexpress.com/en` },
    ],
    ca: (s) => [
      { t: 'Lyft', s: 'Compare against Uber', url: `https://lyft.com/ride?id=lyft&pickup%5Baddress%5D=${enc(s.from)}&destination%5Baddress%5D=${enc(s.to)}` },
      { t: 'Blacklane', s: 'Pre-booked private chauffeur', url: 'https://www.blacklane.com/en/booking/' },
    ],
    au: (s) => [
      { t: 'DiDi', s: 'Usually cheapest in AU cities', url: 'https://web.didiglobal.com/au/' },
      { t: '13cabs', s: 'Licensed taxis, pre-book', url: 'https://www.13cabs.com.au/' },
      { t: 'Ola', s: 'Compare fares', url: 'https://ola.com.au/' },
    ],
  },

  gas: {
    us: (s) => [
      { t: 'GasBuddy', s: 'Cheapest stations, updated live', url: `https://www.gasbuddy.com/home?search=${enc(s.area)}` },
    ],
    au: (s) => [
      { t: 'PetrolSpy', s: 'Live AU fuel prices', url: `https://petrolspy.com.au/map/latlng/-33.87/151.21` },
    ],
  },
};

/** Region-specific cards for a skill (may be empty). `profile` is optional
    extra context some builders use (e.g. home city for Zocdoc). */
export function marketCards(skill, s, profile = {}) {
  const pack = M[skill];
  if (!pack) return [];
  const build = pack[getRegion()] || pack.us;
  return build ? build(s, profile) : [];
}

/** Localised word for gasoline — used in Maps queries and copy. */
export function fuelWord() {
  return { us: 'gas', ca: 'gas', in: 'petrol', uk: 'petrol', au: 'petrol' }[getRegion()];
}

/** Local currency symbol — used for expense tracking output. */
export function currencySymbol() {
  return { us: '$', ca: '$', au: '$', uk: '£', in: '₹' }[getRegion()];
}
