/**
 * Every country (and territory) a trip can name: ISO 3166-1 alpha-2, ISO numeric
 * (the id the map's world-atlas shapes use) and continent, one per line.
 *
 * trip-meta.ts builds COUNTRY_NAMES / COUNTRY_NUMERIC / COUNTRY_CONTINENT from
 * this, with its own spellings layered on top, so a new trip can go anywhere
 * without a code change. Kosovo has no ISO numeric; the map lists it instead.
 * Continents follow the UN regions, except Cyprus (Europe) and Russia (Europe).
 */
const TABLE = `
AF 004 Asia Afghanistan
AX 248 Europe Åland Islands
AL 008 Europe Albania
DZ 012 Africa Algeria
AS 016 Oceania American Samoa
AD 020 Europe Andorra
AO 024 Africa Angola
AI 660 North-America Anguilla
AQ 010 Antarctica Antarctica
AG 028 North-America Antigua and Barbuda
AR 032 South-America Argentina
AM 051 Asia Armenia
AW 533 North-America Aruba
AU 036 Oceania Australia
AT 040 Europe Austria
AZ 031 Asia Azerbaijan
BS 044 North-America Bahamas
BH 048 Asia Bahrain
BD 050 Asia Bangladesh
BB 052 North-America Barbados
BY 112 Europe Belarus
BE 056 Europe Belgium
BZ 084 North-America Belize
BJ 204 Africa Benin
BM 060 North-America Bermuda
BT 064 Asia Bhutan
BO 068 South-America Bolivia
BQ 535 North-America Caribbean Netherlands
BA 070 Europe Bosnia and Herzegovina
BW 072 Africa Botswana
BV 074 Antarctica Bouvet Island
BR 076 South-America Brazil
IO 086 Asia British Indian Ocean Territory
BN 096 Asia Brunei
BG 100 Europe Bulgaria
BF 854 Africa Burkina Faso
BI 108 Africa Burundi
CV 132 Africa Cape Verde
KH 116 Asia Cambodia
CM 120 Africa Cameroon
CA 124 North-America Canada
KY 136 North-America Cayman Islands
CF 140 Africa Central African Republic
TD 148 Africa Chad
CL 152 South-America Chile
CN 156 Asia China
CX 162 Asia Christmas Island
CC 166 Asia Cocos (Keeling) Islands
CO 170 South-America Colombia
KM 174 Africa Comoros
CG 178 Africa Republic of the Congo
CD 180 Africa DR Congo
CK 184 Oceania Cook Islands
CR 188 North-America Costa Rica
CI 384 Africa Côte d’Ivoire
HR 191 Europe Croatia
CU 192 North-America Cuba
CW 531 North-America Curaçao
CY 196 Europe Cyprus
CZ 203 Europe Czechia
DK 208 Europe Denmark
DJ 262 Africa Djibouti
DM 212 North-America Dominica
DO 214 North-America Dominican Republic
EC 218 South-America Ecuador
EG 818 Africa Egypt
SV 222 North-America El Salvador
GQ 226 Africa Equatorial Guinea
ER 232 Africa Eritrea
EE 233 Europe Estonia
SZ 748 Africa Eswatini
ET 231 Africa Ethiopia
FK 238 South-America Falkland Islands
FO 234 Europe Faroe Islands
FJ 242 Oceania Fiji
FI 246 Europe Finland
FR 250 Europe France
GF 254 South-America French Guiana
PF 258 Oceania French Polynesia
TF 260 Antarctica French Southern Territories
GA 266 Africa Gabon
GM 270 Africa Gambia
GE 268 Asia Georgia
DE 276 Europe Germany
GH 288 Africa Ghana
GI 292 Europe Gibraltar
GR 300 Europe Greece
GL 304 North-America Greenland
GD 308 North-America Grenada
GP 312 North-America Guadeloupe
GU 316 Oceania Guam
GT 320 North-America Guatemala
GG 831 Europe Guernsey
GN 324 Africa Guinea
GW 624 Africa Guinea-Bissau
GY 328 South-America Guyana
HT 332 North-America Haiti
HM 334 Antarctica Heard and McDonald Islands
VA 336 Europe Vatican City
HN 340 North-America Honduras
HK 344 Asia Hong Kong
HU 348 Europe Hungary
IS 352 Europe Iceland
IN 356 Asia India
ID 360 Asia Indonesia
IR 364 Asia Iran
IQ 368 Asia Iraq
IE 372 Europe Ireland
IM 833 Europe Isle of Man
IL 376 Asia Israel
IT 380 Europe Italy
JM 388 North-America Jamaica
JP 392 Asia Japan
JE 832 Europe Jersey
JO 400 Asia Jordan
KZ 398 Asia Kazakhstan
KE 404 Africa Kenya
KI 296 Oceania Kiribati
XK - Europe Kosovo
KP 408 Asia North Korea
KR 410 Asia South Korea
KW 414 Asia Kuwait
KG 417 Asia Kyrgyzstan
LA 418 Asia Laos
LV 428 Europe Latvia
LB 422 Asia Lebanon
LS 426 Africa Lesotho
LR 430 Africa Liberia
LY 434 Africa Libya
LI 438 Europe Liechtenstein
LT 440 Europe Lithuania
LU 442 Europe Luxembourg
MO 446 Asia Macao
MG 450 Africa Madagascar
MW 454 Africa Malawi
MY 458 Asia Malaysia
MV 462 Asia Maldives
ML 466 Africa Mali
MT 470 Europe Malta
MH 584 Oceania Marshall Islands
MQ 474 North-America Martinique
MR 478 Africa Mauritania
MU 480 Africa Mauritius
YT 175 Africa Mayotte
MX 484 North-America Mexico
FM 583 Oceania Micronesia
MD 498 Europe Moldova
MC 492 Europe Monaco
MN 496 Asia Mongolia
ME 499 Europe Montenegro
MS 500 North-America Montserrat
MA 504 Africa Morocco
MZ 508 Africa Mozambique
MM 104 Asia Myanmar
NA 516 Africa Namibia
NR 520 Oceania Nauru
NP 524 Asia Nepal
NL 528 Europe Netherlands
NC 540 Oceania New Caledonia
NZ 554 Oceania New Zealand
NI 558 North-America Nicaragua
NE 562 Africa Niger
NG 566 Africa Nigeria
NU 570 Oceania Niue
NF 574 Oceania Norfolk Island
MK 807 Europe North Macedonia
MP 580 Oceania Northern Mariana Islands
NO 578 Europe Norway
OM 512 Asia Oman
PK 586 Asia Pakistan
PW 585 Oceania Palau
PS 275 Asia Palestine
PA 591 North-America Panama
PG 598 Oceania Papua New Guinea
PY 600 South-America Paraguay
PE 604 South-America Peru
PH 608 Asia Philippines
PN 612 Oceania Pitcairn Islands
PL 616 Europe Poland
PT 620 Europe Portugal
PR 630 North-America Puerto Rico
QA 634 Asia Qatar
RE 638 Africa Réunion
RO 642 Europe Romania
RU 643 Europe Russia
RW 646 Africa Rwanda
BL 652 North-America St. Barthélemy
SH 654 Africa St. Helena
KN 659 North-America St. Kitts and Nevis
LC 662 North-America St. Lucia
MF 663 North-America St. Martin
PM 666 North-America St. Pierre and Miquelon
VC 670 North-America St. Vincent and the Grenadines
WS 882 Oceania Samoa
SM 674 Europe San Marino
ST 678 Africa São Tomé and Príncipe
SA 682 Asia Saudi Arabia
SN 686 Africa Senegal
RS 688 Europe Serbia
SC 690 Africa Seychelles
SL 694 Africa Sierra Leone
SG 702 Asia Singapore
SX 534 North-America Sint Maarten
SK 703 Europe Slovakia
SI 705 Europe Slovenia
SB 090 Oceania Solomon Islands
SO 706 Africa Somalia
ZA 710 Africa South Africa
GS 239 Antarctica South Georgia and the South Sandwich Islands
SS 728 Africa South Sudan
ES 724 Europe Spain
LK 144 Asia Sri Lanka
SD 729 Africa Sudan
SR 740 South-America Suriname
SJ 744 Europe Svalbard and Jan Mayen
SE 752 Europe Sweden
CH 756 Europe Switzerland
SY 760 Asia Syria
TW 158 Asia Taiwan
TJ 762 Asia Tajikistan
TZ 834 Africa Tanzania
TH 764 Asia Thailand
TL 626 Asia Timor-Leste
TG 768 Africa Togo
TK 772 Oceania Tokelau
TO 776 Oceania Tonga
TT 780 North-America Trinidad and Tobago
TN 788 Africa Tunisia
TR 792 Asia Türkiye
TM 795 Asia Turkmenistan
TC 796 North-America Turks and Caicos Islands
TV 798 Oceania Tuvalu
UG 800 Africa Uganda
UA 804 Europe Ukraine
AE 784 Asia United Arab Emirates
GB 826 Europe United Kingdom
US 840 North-America United States
UM 581 Oceania U.S. Outlying Islands
UY 858 South-America Uruguay
UZ 860 Asia Uzbekistan
VU 548 Oceania Vanuatu
VE 862 South-America Venezuela
VN 704 Asia Vietnam
VG 092 North-America British Virgin Islands
VI 850 North-America U.S. Virgin Islands
WF 876 Oceania Wallis and Futuna
EH 732 Africa Western Sahara
YE 887 Asia Yemen
ZM 894 Africa Zambia
ZW 716 Africa Zimbabwe
`;

export interface Country { code: string; numeric: string | null; continent: string; name: string }

export const COUNTRIES: Country[] = TABLE.trim().split('\n').map((row) => {
  const [code, numeric, continent, ...name] = row.split(' ');
  return { code, numeric: numeric === '-' ? null : numeric, continent: continent.replace('-', ' '), name: name.join(' ') };
});
