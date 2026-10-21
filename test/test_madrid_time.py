from datetime import datetime, timezone

import pytest

from api.madrid_time import format_madrid_datetime, madrid_clock, madrid_date_days_ago, madrid_local_to_utc


def test_hora_de_verano_madrid_va_2_horas_por_delante():
    assert madrid_local_to_utc("2026-10-23T17:00") == datetime(2026, 10, 23, 15, 0, tzinfo=timezone.utc)


def test_hora_de_invierno_tras_el_cambio_va_1_hora_por_delante():
    assert madrid_local_to_utc("2026-10-26T17:00") == datetime(2026, 10, 26, 16, 0, tzinfo=timezone.utc)


def test_el_dia_del_cambio_a_verano_usa_el_desfase_nuevo():
    assert madrid_local_to_utc("2026-03-29T10:00") == datetime(2026, 3, 29, 8, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("value", ["mañana a las 5", "2026-02-30T10:00", "2026-10-23T25:00"])
def test_rechaza_fechas_mal_formadas_o_inexistentes(value):
    with pytest.raises(ValueError):
        madrid_local_to_utc(value)


def test_madrid_clock_da_la_hora_local_y_detecta_el_domingo():
    clock = madrid_clock(datetime(2026, 10, 25, 19, 0, tzinfo=timezone.utc))
    assert clock.local_date_time == "2026-10-25T20:00"
    assert clock.hour == 20
    assert clock.is_sunday
    assert clock.weekday == "domingo"


def test_madrid_clock_cambia_de_dia_segun_la_hora_de_madrid():
    assert madrid_clock(datetime(2026, 10, 21, 22, 30, tzinfo=timezone.utc)).local_date == "2026-10-22"


def test_madrid_date_days_ago_resta_dias_sobre_la_fecha_local():
    assert madrid_date_days_ago(datetime(2026, 10, 21, 10, 0, tzinfo=timezone.utc), 7) == "2026-10-14"


def test_format_madrid_datetime_en_espanol():
    assert format_madrid_datetime(datetime(2026, 10, 23, 15, 0, tzinfo=timezone.utc)) == "viernes, 23 de octubre, 17:00"
